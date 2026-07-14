import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import type { MailInboundAttachment } from "@/lib/email-account-types";
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
import { resolveMailboxDataOwnerUid } from "@/lib/email/mailbox-data-owner-server";
import { resolveMailboxTransportAuthServer } from "@/lib/email/resolve-mailbox-transport-auth";
import { resolveSentMailboxPath } from "@/lib/email/resolve-sent-mailbox";
import { resolveTrashMailboxPath } from "@/lib/email/resolve-trash-mailbox";

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

    const forUser = new URL(req.url).searchParams.get("forUser");
    const b = (await req.json()) as Record<string, unknown>;
    const imap = b.imap as Record<string, unknown> | undefined;
    const mailboxId = String(b.mailboxId ?? "").trim();
    const resolved = await resolveMailboxDataOwnerUid({
      organizationId: g.ctx.session.organizationId,
      viewerUid: g.ctx.session.uid,
      viewerRole: g.ctx.role,
      forUserParam: forUser,
      mailboxId,
    });
    if (!resolved.ok) {
      return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
    }
    const dataOwnerUid = resolved.dataOwnerUid;
    const host = normalizeMailHost(String(imap?.host ?? ""));
    const port = Number(imap?.port ?? 993);
    const secure = Boolean(imap?.secure);
    const auth = await resolveMailboxTransportAuthServer({
      organizationId: g.ctx.session.organizationId,
      uid: dataOwnerUid,
      mailboxId,
      fallbackUser: String(imap?.user ?? "").trim(),
      fallbackPass: String(imap?.pass ?? ""),
      prefer: "imap",
    });
    const user = auth.user;
    const pass = auth.pass;
    const accessToken = auth.accessToken;
    const requested = Number(b.limit);
    const limit =
      Number.isFinite(requested) && requested > 0
        ? Math.min(MAX_LIMIT, Math.floor(requested))
        : DEFAULT_LIMIT;

    const requestedOffset = Number(b.offset);
    const offset =
      Number.isFinite(requestedOffset) && requestedOffset > 0
        ? Math.min(Math.floor(requestedOffset), 10_000_000)
        : 0;

    if (!host || !user) {
      return NextResponse.json(
        { ok: false, error: "IMAP host and username are required." },
        { status: 400 },
      );
    }
    if (!accessToken && !pass) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "IMAP credentials missing. For Google Workspace, reconnect with Sign in with Google in Settings → Email.",
        },
        { status: 400 },
      );
    }

    const client = new ImapFlow(
      imapFlowConnectionOptions({
        host,
        port,
        secure,
        user,
        pass,
        accessToken,
        purpose: "fetch",
      }),
    );
    client.on("error", () => undefined);

    await client.connect();

    const folderRaw = String((b as Record<string, unknown>).folder ?? "inbox").toLowerCase();
    let mailboxPath = "INBOX";
    let resolvedFolder: string | undefined;
    if (folderRaw === "trash") {
      const resolved = await resolveTrashMailboxPath(client);
      if (!resolved) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Could not find a Trash folder on this account. Trash sync requires a standard Trash / Deleted Items mailbox.",
          },
          { status: 400 },
        );
      }
      mailboxPath = resolved;
      resolvedFolder = resolved;
    } else if (folderRaw === "sent") {
      const resolved = await resolveSentMailboxPath(client);
      if (!resolved) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Could not find a Sent folder on this account. Sent sync requires a standard Sent / Sent Items mailbox.",
          },
          { status: 400 },
        );
      }
      mailboxPath = resolved;
      resolvedFolder = resolved;
    }

    const lock = await client.getMailboxLock(mailboxPath, { readOnly: true });
    try {
      const uids = await client.search({ all: true }, { uid: true });
      if (!uids || uids.length === 0) {
        return NextResponse.json({ ok: true, messages: [] as unknown[], mailboxTotal: 0 });
      }

      const sorted = [...uids].sort((a, b) => b - a);
      const mailboxTotal = sorted.length;
      if (offset >= sorted.length) {
        return NextResponse.json({
          ok: true,
          messages: [] as unknown[],
          mailboxTotal,
          offset,
          loadedThrough: sorted.length,
        });
      }
      const slice = sorted.slice(offset, offset + limit);

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

      let skippedNoEnvelope = 0;
      const messages = await Promise.all(
        slice.map(async (uid) => {
          const msg = envByUid.get(uid);
          if (!msg?.envelope) {
            skippedNoEnvelope += 1;
            return null;
          }

          const env = msg.envelope;
          const { subj, from, to, cc: ccFromEnv, envExt } = envelopeHeaderFields(env);
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

          let listUnsubscribe: string | undefined;

          const inBodyTier = uidsForBody.includes(uid);
          const src = sourceByUid.get(uid);

          let preview = "";
          let bodyText = "";
          let bodyHtml: string | undefined;
          let cc = ccFromEnv.trim() ? ccFromEnv : undefined;
          let attachments: MailInboundAttachment[] | undefined;
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
              if (parsed.cc.trim()) cc = parsed.cc;
              if (parsed.attachments.length > 0) attachments = parsed.attachments;
              if (parsed.listUnsubscribe) listUnsubscribe = parsed.listUnsubscribe;
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
            ...(cc ? { cc } : {}),
            date,
            seen: msg.flags?.has("\\Seen") ?? false,
            preview,
            bodyText: bodySynced ? bodyText || preview : "",
            bodyHtml,
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
            messageId,
            inReplyTo,
            referenceIds: referenceIds.length > 0 ? referenceIds : undefined,
            bodySynced,
            ...(listUnsubscribe ? { listUnsubscribe } : {}),
          };
        }),
      );

      const parsed = messages.filter(Boolean);
      return NextResponse.json({
        ok: true,
        messages: parsed,
        mailboxTotal,
        offset,
        loadedThrough: offset + slice.length,
        mailboxPath: resolvedFolder ?? mailboxPath,
        skippedNoEnvelope,
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
