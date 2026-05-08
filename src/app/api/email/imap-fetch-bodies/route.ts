import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { normalizeMessageId, parseReferencesField } from "@/lib/email/thread-inbound";
import {
  envelopeHeaderFields,
  parseMailSourceFields,
} from "@/lib/email/parse-imap-fetched-message";
import { formatImapError, imapFlowConnectionOptions } from "@/lib/email/imap-client-options";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getMailboxSecretsServer } from "@/lib/email/mailbox-secrets-server";
import { resolveTrashMailboxPath } from "@/lib/email/resolve-trash-mailbox";

const MAX_UIDS = 55;
const SOURCE_MAX_LENGTH = 120_000;
const FETCH_BATCH = 25;

export async function POST(req: Request) {
  try {
    const g = await guardTenantApi();
    if (!g.ok) return g.response;

    const b = (await req.json()) as Record<string, unknown>;
    const imap = b.imap as Record<string, unknown> | undefined;
    const mailboxId = String(b.mailboxId ?? "").trim();
    const uidsRaw = b.uids;
    const uids = Array.isArray(uidsRaw)
      ? uidsRaw
          .map((x) => Number(x))
          .filter((n) => Number.isFinite(n) && n > 0)
          .slice(0, MAX_UIDS)
      : [];

    if (uids.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Provide uids (non-empty array of IMAP UID numbers)." },
        { status: 400 },
      );
    }

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

    if (!host || !user) {
      return NextResponse.json(
        { ok: false, error: "IMAP host and username are required." },
        { status: 400 },
      );
    }

    const client = new ImapFlow(
      imapFlowConnectionOptions({ host, port, secure, user, pass, purpose: "fetch" }),
    );
    client.on("error", () => undefined);

    await client.connect();

    const folderRaw = String((b as Record<string, unknown>).folder ?? "inbox").toLowerCase();
    let mailboxPath = "INBOX";
    if (folderRaw === "trash") {
      const resolved = await resolveTrashMailboxPath(client);
      if (!resolved) {
        return NextResponse.json(
          { ok: false, error: "Could not locate Trash folder on the server." },
          { status: 400 },
        );
      }
      mailboxPath = resolved;
    }

    const lock = await client.getMailboxLock(mailboxPath, { readOnly: true });
    try {
      const updates: Array<{
        uid: number;
        preview: string;
        bodyText: string;
        bodyHtml?: string;
        messageId?: string;
        inReplyTo?: string;
        referenceIds?: string[];
        bodySynced: boolean;
      }> = [];

      for (let i = 0; i < uids.length; i += FETCH_BATCH) {
        const batch = uids.slice(i, i + FETCH_BATCH);
        const rows = await client.fetchAll(
          batch,
          {
            uid: true,
            envelope: true,
            source: { maxLength: SOURCE_MAX_LENGTH },
          },
          { uid: true },
        );
        for (const row of rows) {
          const subjFallback = row.envelope
            ? envelopeHeaderFields(row.envelope).subj
            : "(no subject)";

          if (!row.source?.length) {
            updates.push({
              uid: row.uid,
              preview: subjFallback,
              bodyText: "",
              bodySynced: true,
            });
            continue;
          }
          try {
            const parsed = await parseMailSourceFields(row.source);
            let messageId = parsed.messageId;
            let inReplyTo = parsed.inReplyTo;
            let referenceIds = parsed.referenceIds;
            if (row.envelope) {
              const envExt = row.envelope as {
                messageId?: string;
                inReplyTo?: string;
                references?: string | string[];
              };
              if (!messageId) messageId = normalizeMessageId(envExt.messageId) ?? undefined;
              if (!inReplyTo) inReplyTo = normalizeMessageId(envExt.inReplyTo) ?? undefined;
              if (!referenceIds?.length) {
                const ref = parseReferencesField(envExt.references);
                if (ref.length) referenceIds = ref;
              }
            }
            const preview = parsed.preview || subjFallback;
            const bodyText = parsed.bodyText || preview;
            updates.push({
              uid: row.uid,
              preview,
              bodyText,
              bodyHtml: parsed.bodyHtml,
              messageId,
              inReplyTo,
              referenceIds,
              bodySynced: true,
            });
          } catch {
            updates.push({
              uid: row.uid,
              preview: subjFallback,
              bodyText: "",
              bodySynced: true,
            });
          }
        }
      }

      return NextResponse.json({ ok: true, updates });
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
