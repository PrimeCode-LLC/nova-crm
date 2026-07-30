import { ImapFlow } from "imapflow";
import type { MailInbound, MailInboundAttachment } from "@/lib/email-account-types";
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
import { resolveSentMailboxPath } from "@/lib/email/resolve-sent-mailbox";
import { resolveTrashMailboxPath } from "@/lib/email/resolve-trash-mailbox";

/** Default number of newest INBOX messages to list in one refresh. */
export const IMAP_FETCH_DEFAULT_LIMIT = 600;
/** Hard cap per request (large mailboxes: bodies for the newest subset only). */
export const IMAP_FETCH_MAX_LIMIT = 2_000;
/** Download RFC822 for the newest N messages in this request; older rows load on thread open. */
export const IMAP_FULL_BODY_SYNC_CAP = 320;
/**
 * Cron inbox head page - full window for unread/bounce accuracy.
 * Client background badge sync uses `BACKGROUND_IMAP_HEAD_LIMIT` (smaller) instead.
 */
export const IMAP_CRON_HEAD_LIMIT = 800;

const SOURCE_MAX_LENGTH = 88_000;
const BODY_FETCH_BATCH = 45;

export type ImapFolderKind = "inbox" | "sent" | "trash";

export type FetchImapFolderInput = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  accessToken?: string;
  folder: ImapFolderKind;
  limit: number;
  offset?: number;
  headsOnly?: boolean;
};

export type FetchImapFolderResult = {
  messages: MailInbound[];
  mailboxTotal: number;
  offset: number;
  loadedThrough: number;
  mailboxPath: string;
  skippedNoEnvelope: number;
};

/**
 * Shared IMAP folder fetch used by the interactive API route and the inbox cron.
 */
export async function fetchImapFolderServer(
  input: FetchImapFolderInput,
): Promise<FetchImapFolderResult> {
  const host = normalizeMailHost(input.host);
  const user = input.user.trim();
  const pass = input.pass ?? "";
  const accessToken = input.accessToken;
  const limit = Math.min(
    IMAP_FETCH_MAX_LIMIT,
    Math.max(1, Math.floor(input.limit) || IMAP_FETCH_DEFAULT_LIMIT),
  );
  const offset =
    Number.isFinite(input.offset) && (input.offset ?? 0) > 0
      ? Math.min(Math.floor(input.offset!), 10_000_000)
      : 0;
  const headsOnly = Boolean(input.headsOnly);

  if (!host || !user) {
    throw new Error("IMAP host and username are required.");
  }
  if (!accessToken && !pass) {
    throw new Error(
      "IMAP credentials missing. For Google Workspace, reconnect with Sign in with Google in Settings → Email.",
    );
  }

  const client = new ImapFlow(
    imapFlowConnectionOptions({
      host,
      port: input.port,
      secure: input.secure,
      user,
      pass,
      accessToken,
      purpose: "fetch",
    }),
  );
  client.on("error", () => undefined);

  await client.connect();

  let mailboxPath = "INBOX";
  let resolvedFolder: string | undefined;
  if (input.folder === "trash") {
    const resolved = await resolveTrashMailboxPath(client);
    if (!resolved) {
      throw new Error(
        "Could not find a Trash folder on this account. Trash sync requires a standard Trash / Deleted Items mailbox.",
      );
    }
    mailboxPath = resolved;
    resolvedFolder = resolved;
  } else if (input.folder === "sent") {
    const resolved = await resolveSentMailboxPath(client);
    if (!resolved) {
      throw new Error(
        "Could not find a Sent folder on this account. Sent sync requires a standard Sent / Sent Items mailbox.",
      );
    }
    mailboxPath = resolved;
    resolvedFolder = resolved;
  }

  const lock = await client.getMailboxLock(mailboxPath, { readOnly: true });
  try {
    const uids = await client.search({ all: true }, { uid: true });
    if (!uids || uids.length === 0) {
      return {
        messages: [],
        mailboxTotal: 0,
        offset,
        loadedThrough: 0,
        mailboxPath: resolvedFolder ?? mailboxPath,
        skippedNoEnvelope: 0,
      };
    }

    const sorted = [...uids].sort((a, b) => b - a);
    const mailboxTotal = sorted.length;
    if (offset >= sorted.length) {
      return {
        messages: [],
        mailboxTotal,
        offset,
        loadedThrough: sorted.length,
        mailboxPath: resolvedFolder ?? mailboxPath,
        skippedNoEnvelope: 0,
      };
    }
    const slice = sorted.slice(offset, offset + limit);

    const envelopeRows = await client.fetchAll(
      slice,
      { uid: true, flags: true, envelope: true, internalDate: true },
      { uid: true },
    );
    const envByUid = new Map(envelopeRows.map((r) => [r.uid, r]));

    const uidsForBody = headsOnly
      ? ([] as number[])
      : slice.slice(0, Math.min(IMAP_FULL_BODY_SYNC_CAP, slice.length));
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
        const date = (
          msg.internalDate instanceof Date
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
        let replyTo: string | undefined;
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
            if (parsed.replyTo) replyTo = parsed.replyTo;
            if (parsed.attachments.length > 0) attachments = parsed.attachments;
            if (parsed.listUnsubscribe) listUnsubscribe = parsed.listUnsubscribe;
            bodySynced = true;
          } catch {
            preview = "";
            bodyText = "";
            bodySynced = false;
          }
        } else if (inBodyTier) {
          bodySynced = true;
        } else {
          bodySynced = false;
        }

        if (!preview) preview = subj;
        if (!bodyText && bodySynced) bodyText = preview;

        const row: MailInbound = {
          id: `uid-${msg.uid}`,
          uid: msg.uid,
          subject: subj,
          from,
          ...(replyTo ? { replyTo } : {}),
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
        return row;
      }),
    );

    return {
      messages: messages.filter((m): m is MailInbound => Boolean(m)),
      mailboxTotal,
      offset,
      loadedThrough: offset + slice.length,
      mailboxPath: resolvedFolder ?? mailboxPath,
      skippedNoEnvelope,
    };
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
}

export function toImapFetchErrorMessage(e: unknown): string {
  return formatImapError(e);
}
