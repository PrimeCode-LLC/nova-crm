import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import {
  normalizeMessageId,
  parseReferencesField,
} from "@/lib/email/thread-inbound";
import {
  envelopeHeaderFields,
  parseMailSourceFields,
} from "@/lib/email/parse-imap-fetched-message";
import { formatImapError, imapFlowConnectionOptions } from "@/lib/email/imap-client-options";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getMailboxSecretsServer } from "@/lib/email/mailbox-secrets-server";

/** Default number of newest INBOX messages to list in one refresh. */
const DEFAULT_LIMIT = 600;
/** Hard cap per request (large mailboxes: bodies for the newest subset only). */
const MAX_LIMIT = 2_000;
/** Download RFC822 for the newest N messages in this request; older rows load on thread open. */
const FULL_BODY_SYNC_CAP = 320;
const SOURCE_MAX_LENGTH = 88_000;
const BODY_FETCH_BATCH = 45;

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
    client.on("error", () => undefined);

    await client.connect();
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const uids = await client.search({ all: true }, { uid: true });
      if (!uids || uids.length === 0) {
        return NextResponse.json({ ok: true, messages: [] as unknown[], mailboxTotal: 0 });
      }

      const sorted = [...uids].sort((a, b) => b - a);
      const mailboxTotal = sorted.length;
      const slice = sorted.slice(0, limit);

      const envelopeRows = await client.fetchAll(
        slice,
        { uid: true, flags: true, envelope: true, internalDate: true },
        { uid: true },
      );
      const envByUid = new Map(envelopeRows.map((r) => [r.uid, r]));

      const uidsForBody = slice.slice(0, Math.min(FULL_BODY_SYNC_CAP, slice.length));
      const sourceByUid = new Map<number, Buffer>();
      for (let i = 0; i < uidsForBody.length; i += BODY_FETCH_BATCH) {
        const batch = uidsForBody.slice(i, i + BODY_FETCH_BATCH);
        const rows = await client.fetchAll(
          batch,
          { uid: true, source: { maxLength: SOURCE_MAX_LENGTH } },
          { uid: true },
        );
        for (const r of rows) {
          if (r.source && r.source.length > 0) sourceByUid.set(r.uid, r.source);
        }
      }

      const messages = await Promise.all(
        slice.map(async (uid) => {
          const msg = envByUid.get(uid);
          if (!msg?.envelope) return null;

          const env = msg.envelope;
          const { subj, from, to, envExt } = envelopeHeaderFields(env);
          const date =
            (msg.internalDate instanceof Date
              ? msg.internalDate
              : env.date
                ? new Date(env.date)
                : new Date()
            ).toISOString();

          let messageId = normalizeMessageId(envExt?.messageId);
          let inReplyTo = normalizeMessageId(envExt?.inReplyTo);
          let referenceIds = parseReferencesField(envExt?.references);

          const inBodyTier = uidsForBody.includes(uid);
          const src = sourceByUid.get(uid);

          let preview = "";
          let bodyText = "";
          let bodyHtml: string | undefined;
          let bodySynced: boolean;

          if (inBodyTier && src && src.length > 0) {
            try {
              const parsed = await parseMailSourceFields(src);
              bodyText = parsed.bodyText;
              bodyHtml = parsed.bodyHtml;
              preview = parsed.preview;
              if (parsed.messageId) messageId = parsed.messageId ?? messageId;
              if (parsed.inReplyTo) inReplyTo = parsed.inReplyTo ?? inReplyTo;
              if (parsed.referenceIds?.length) referenceIds = parsed.referenceIds;
              bodySynced = true;
            } catch {
              preview = "";
              bodyText = "";
              bodySynced = true;
            }
          } else if (inBodyTier) {
            bodySynced = true;
          } else {
            bodySynced = false;
          }

          if (!preview) preview = subj;
          if (!bodyText && bodySynced) bodyText = preview;

          return {
            id: `uid-${msg.uid}`,
            uid: msg.uid,
            subject: subj,
            from,
            to,
            date,
            seen: msg.flags?.has("\\Seen") ?? false,
            preview,
            bodyText: bodySynced ? bodyText || preview : "",
            bodyHtml,
            messageId,
            inReplyTo,
            referenceIds: referenceIds.length > 0 ? referenceIds : undefined,
            bodySynced,
          };
        }),
      );

      return NextResponse.json({
        ok: true,
        messages: messages.filter(Boolean),
        mailboxTotal,
      });
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
