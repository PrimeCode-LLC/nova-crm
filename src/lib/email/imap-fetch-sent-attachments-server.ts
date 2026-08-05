import { ImapFlow } from "imapflow";
import type { MailInboundAttachment } from "@/lib/email-account-types";
import { formatImapError, imapFlowConnectionOptions } from "@/lib/email/imap-client-options";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { parseMailSourceFields } from "@/lib/email/parse-imap-fetched-message";
import { resolveSentMailboxPath } from "@/lib/email/resolve-sent-mailbox";
import { normalizeMessageId } from "@/lib/email/thread-inbound";

const SOURCE_MAX_LENGTH = 12_000_000;
const MAX_MESSAGE_IDS = 20;

export type SentAttachmentUpdate = {
  messageId: string;
  uid: number;
  attachments: MailInboundAttachment[];
};

export async function fetchImapSentAttachmentsByMessageIdsServer(input: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  accessToken?: string;
  messageIds: string[];
}): Promise<SentAttachmentUpdate[]> {
  const host = normalizeMailHost(input.host);
  const user = input.user.trim();
  const pass = input.pass ?? "";
  const accessToken = input.accessToken;
  const messageIds = [
    ...new Set(input.messageIds.map((id) => normalizeMessageId(id)).filter((id): id is string => Boolean(id))),
  ].slice(0, MAX_MESSAGE_IDS);

  if (!host || !user) throw new Error("IMAP host and username are required.");
  if (!accessToken && !pass) {
    throw new Error(
      "IMAP credentials missing. For Google Workspace, reconnect with Sign in with Google in Settings → Email.",
    );
  }
  if (messageIds.length === 0) return [];

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

  const mailboxPath = await resolveSentMailboxPath(client);
  if (!mailboxPath) throw new Error("Could not locate Sent folder on the server.");

  const lock = await client.getMailboxLock(mailboxPath, { readOnly: true });
  try {
    const uidByMessageId = new Map<string, number>();
    for (const messageId of messageIds) {
      const candidates = [`<${messageId}>`, messageId];
      for (const value of candidates) {
        let found: number[] | false = false;
        try {
          found = await client.search({ header: { "Message-ID": value } }, { uid: true });
        } catch {
          found = false;
        }
        if ((!found || found.length === 0) && host.includes("gmail")) {
          try {
            found = await client.search({ gmraw: `rfc822msgid:${messageId}` }, { uid: true });
          } catch {
            found = false;
          }
        }
        const uid = Array.isArray(found) ? found[0] : undefined;
        if (typeof uid === "number" && uid > 0) {
          uidByMessageId.set(messageId, uid);
          break;
        }
      }
    }

    const uids = [...new Set(uidByMessageId.values())];
    if (uids.length === 0) return [];

    const rows = await client.fetchAll(
      uids,
      { uid: true, source: { maxLength: SOURCE_MAX_LENGTH } },
      { uid: true },
    );
    const parsedByUid = new Map<number, MailInboundAttachment[]>();
    for (const row of rows) {
      if (!row.source?.length) {
        parsedByUid.set(row.uid, []);
        continue;
      }
      try {
        const parsed = await parseMailSourceFields(row.source);
        parsedByUid.set(row.uid, parsed.attachments ?? []);
      } catch {
        parsedByUid.set(row.uid, []);
      }
    }

    const updates: SentAttachmentUpdate[] = [];
    for (const [messageId, uid] of uidByMessageId) {
      updates.push({
        messageId,
        uid,
        attachments: parsedByUid.get(uid) ?? [],
      });
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

export function toImapSentAttachmentsErrorMessage(e: unknown): string {
  return formatImapError(e);
}
