import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import {
  normalizeMessageId,
  parseReferencesField,
} from "@/lib/email/thread-inbound";
import { formatImapError, imapFlowConnectionOptions } from "@/lib/email/imap-client-options";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getMailboxSecretsServer } from "@/lib/email/mailbox-secrets-server";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function formatAddressList(
  list: { name?: string; address?: string }[] | undefined,
): string {
  if (!list?.length) return "";
  return list
    .map((a) => {
      const addr = a.address?.trim() ?? "";
      if (a.name?.trim()) {
        return `${a.name.replace(/"/g, "")} <${addr}>`;
      }
      return addr;
    })
    .filter(Boolean)
    .join(", ");
}

export async function POST(req: Request) {
  try {
    const g = await guardTenantApi();
    if (!g.ok) return g.response;

    const b = (await req.json()) as Record<string, unknown>;
    const imap = b.imap as Record<string, unknown> | undefined;
    const mailboxId = String(b.mailboxId ?? "").trim();
    const host = normalizeMailHost(String(imap?.host ?? ""));
    const port = Number(imap?.port ?? 993);
    const secure = Boolean(imap?.secure);
    let user = String(imap?.user ?? "").trim();
    let pass = String(imap?.pass ?? "");
    if (mailboxId) {
      const secrets = await getMailboxSecretsServer({
        organizationId: g.ctx.session.organizationId,
        uid: g.ctx.session.uid,
        mailboxId,
      });
      if (secrets) {
        const fromVault = secrets.imap.user.trim();
        if (fromVault) user = fromVault;
        if (secrets.imap.password) pass = secrets.imap.password;
      }
    }
    const requested = Number(b.limit);
    const limit =
      Number.isFinite(requested) && requested > 0
        ? Math.min(MAX_LIMIT, Math.floor(requested))
        : DEFAULT_LIMIT;

    if (!host || !user) {
      return NextResponse.json(
        { ok: false, error: "IMAP host and username are required." },
        { status: 400 },
      );
    }

    const client = new ImapFlow(
      imapFlowConnectionOptions({ host, port, secure, user, pass, purpose: "fetch" }),
    );
    /* imapflow may emit socket "error" after a timeout; without a listener Node treats it as uncaught. */
    client.on("error", () => undefined);

    await client.connect();
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const uids = await client.search({ all: true }, { uid: true });
      if (!uids || uids.length === 0) {
        return NextResponse.json({ ok: true, messages: [] as unknown[] });
      }

      const sorted = [...uids].sort((a, b) => b - a);
      const slice = sorted.slice(0, limit);

      const raw = await client.fetchAll(
        slice,
        {
          uid: true,
          flags: true,
          envelope: true,
          internalDate: true,
          source: { maxLength: 512_000 },
        },
        { uid: true },
      );

      const messages = await Promise.all(
        raw.map(async (msg) => {
          const env = msg.envelope;
          const subj = env?.subject?.trim() || "(no subject)";
          const from = formatAddressList(env?.from) || "Unknown";
          const to = formatAddressList(env?.to);
          const date =
            (msg.internalDate instanceof Date
              ? msg.internalDate
              : env?.date
                ? new Date(env.date)
                : new Date()
            ).toISOString();

          const envExt = env as
            | { messageId?: string; inReplyTo?: string; references?: string | string[] }
            | undefined;

          let preview = "";
          let bodyText = "";
          let bodyHtml: string | undefined;
          let messageId = normalizeMessageId(envExt?.messageId);
          let inReplyTo = normalizeMessageId(envExt?.inReplyTo);
          let referenceIds = parseReferencesField(envExt?.references);
          if (msg.source && msg.source.length > 0) {
            try {
              const parsed = await simpleParser(msg.source);
              bodyText = (parsed.text || "").trim();
              if (typeof parsed.html === "string" && parsed.html.length > 0) {
                bodyHtml = parsed.html;
              }
              const p = bodyText.replace(/\s+/g, " ").trim();
              preview = p.length > 220 ? `${p.slice(0, 220)}…` : p;
              const mid =
                normalizeMessageId(
                  typeof parsed.messageId === "string"
                    ? parsed.messageId
                    : parsed.messageId && typeof parsed.messageId === "object" && "value" in parsed.messageId
                      ? String((parsed.messageId as { value?: string }).value ?? "")
                      : undefined,
                ) ?? messageId;
              messageId = mid ?? messageId;
              const irt =
                normalizeMessageId(
                  typeof parsed.inReplyTo === "string"
                    ? parsed.inReplyTo
                    : parsed.inReplyTo && typeof parsed.inReplyTo === "object" && "value" in parsed.inReplyTo
                      ? String((parsed.inReplyTo as { value?: string }).value ?? "")
                      : undefined,
                ) ?? inReplyTo;
              inReplyTo = irt ?? inReplyTo;
              const refParsed = parseReferencesField(parsed.references);
              if (refParsed.length > 0) referenceIds = refParsed;
            } catch {
              preview = "";
            }
          }

          if (!preview) {
            preview = subj;
          }

          return {
            id: `uid-${msg.uid}`,
            uid: msg.uid,
            subject: subj,
            from,
            to,
            date,
            seen: msg.flags?.has("\\Seen") ?? false,
            preview,
            bodyText: bodyText || preview,
            bodyHtml,
            messageId,
            inReplyTo,
            referenceIds: referenceIds.length > 0 ? referenceIds : undefined,
          };
        }),
      );

      return NextResponse.json({ ok: true, messages });
    } finally {
      try {
        lock.release();
      } catch {
        /* ignore */
      }
      try {
        await client.logout();
      } catch {
        client.close();
      }
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: formatImapError(e) }, { status: 400 });
  }
}
