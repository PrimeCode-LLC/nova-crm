import type { MailInboundAttachment } from "@/lib/email-account-types";
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
import { resolveMailboxDataOwnerUid } from "@/lib/email/mailbox-data-owner-server";
import { resolveSentMailboxPath } from "@/lib/email/resolve-sent-mailbox";
import { resolveTrashMailboxPath } from "@/lib/email/resolve-trash-mailbox";

const MAX_UIDS = 55;
/** Large enough for typical HTML bodies + PDF invoices when opening a thread. */
const SOURCE_MAX_LENGTH = 3_500_000;
const FETCH_BATCH = 25;

export async function POST(req: Request) {
  try {
    const g = await guardTenantApi();
    if (!g.ok) return g.response;

    const forUser = new URL(req.url).searchParams.get("forUser");
    const resolved = await resolveMailboxDataOwnerUid({
      organizationId: g.ctx.session.organizationId,
      viewerUid: g.ctx.session.uid,
      viewerRole: g.ctx.role,
      forUserParam: forUser,
    });
    if (!resolved.ok) {
      return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
    }
    const dataOwnerUid = resolved.dataOwnerUid;

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
        uid: dataOwnerUid,
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
    } else if (folderRaw === "sent") {
      const resolved = await resolveSentMailboxPath(client);
      if (!resolved) {
        return NextResponse.json(
          { ok: false, error: "Could not locate Sent folder on the server." },
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
        cc?: string;
        attachments?: MailInboundAttachment[];
        messageId?: string;
        inReplyTo?: string;
        referenceIds?: string[];
        listUnsubscribe?: string;
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
            const envCc = row.envelope ? envelopeHeaderFields(row.envelope).cc.trim() : "";
            const cc: string | undefined = parsed.cc.trim() ? parsed.cc : envCc ? envCc : undefined;
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
            const attachments =
              parsed.attachments.length > 0 ? parsed.attachments : undefined;
            updates.push({
              uid: row.uid,
              preview,
              bodyText,
              bodyHtml: parsed.bodyHtml,
              cc,
              attachments,
              messageId,
              inReplyTo,
              referenceIds,
              listUnsubscribe: parsed.listUnsubscribe,
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
