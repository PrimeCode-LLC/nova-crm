import { ImapFlow } from "imapflow";
import type { MailInboundAttachment } from "@/lib/email-account-types";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { normalizeMessageId, parseReferencesField } from "@/lib/email/thread-inbound";
import {
  envelopeHeaderFields,
  parseMailSourceFields,
} from "@/lib/email/parse-imap-fetched-message";
import { formatImapError, imapFlowConnectionOptions } from "@/lib/email/imap-client-options";
import { resolveSentMailboxPath } from "@/lib/email/resolve-sent-mailbox";
import { resolveTrashMailboxPath } from "@/lib/email/resolve-trash-mailbox";
import type { ImapFolderKind } from "@/lib/email/imap-fetch-folder-server";

const DEFAULT_MAX_UIDS = 55;
/** Enough for typical DSN / HTML bodies without shipping huge attachments. */
const SOURCE_MAX_LENGTH = 3_500_000;
const FETCH_BATCH = 25;

export type ImapBodyUpdate = {
  uid: number;
  preview: string;
  bodyText: string;
  bodyHtml?: string;
  cc?: string;
  replyTo?: string;
  attachments?: MailInboundAttachment[];
  messageId?: string;
  inReplyTo?: string;
  referenceIds?: string[];
  listUnsubscribe?: string;
  bodySynced: boolean;
};

export type FetchImapBodiesInput = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  accessToken?: string;
  folder?: ImapFolderKind;
  uids: number[];
  /** Cap UIDs fetched in one call (default 55). */
  maxUids?: number;
};

/**
 * Fetch RFC822 bodies for specific IMAP UIDs (thread open + cron bounce parse).
 */
export async function fetchImapBodiesServer(
  input: FetchImapBodiesInput,
): Promise<ImapBodyUpdate[]> {
  const host = normalizeMailHost(input.host);
  const user = input.user.trim();
  const pass = input.pass ?? "";
  const accessToken = input.accessToken;
  const maxUids = Math.max(1, Math.min(200, input.maxUids ?? DEFAULT_MAX_UIDS));
  const uids = [
    ...new Set(
      input.uids.filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.floor(n)),
    ),
  ].slice(0, maxUids);

  if (!host || !user) {
    throw new Error("IMAP host and username are required.");
  }
  if (!accessToken && !pass) {
    throw new Error(
      "IMAP credentials missing. For Google Workspace, reconnect with Sign in with Google in Settings → Email.",
    );
  }
  if (uids.length === 0) return [];

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

  const folder = input.folder ?? "inbox";
  let mailboxPath = "INBOX";
  if (folder === "trash") {
    const resolved = await resolveTrashMailboxPath(client);
    if (!resolved) throw new Error("Could not locate Trash folder on the server.");
    mailboxPath = resolved;
  } else if (folder === "sent") {
    const resolved = await resolveSentMailboxPath(client);
    if (!resolved) throw new Error("Could not locate Sent folder on the server.");
    mailboxPath = resolved;
  }

  const lock = await client.getMailboxLock(mailboxPath, { readOnly: true });
  try {
    const updates: ImapBodyUpdate[] = [];
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
          const cc: string | undefined = parsed.cc.trim()
            ? parsed.cc
            : envCc
              ? envCc
              : undefined;
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
            replyTo: parsed.replyTo,
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
            bodySynced: false,
          });
        }
      }
    }
    return updates;
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

export function toImapBodiesErrorMessage(e: unknown): string {
  return formatImapError(e);
}
