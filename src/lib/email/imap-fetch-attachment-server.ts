import { ImapFlow } from "imapflow";
import type { ImapFolderKind } from "@/lib/email/imap-fetch-folder-server";
import { formatImapError, imapFlowConnectionOptions } from "@/lib/email/imap-client-options";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { parseMailSourceFields } from "@/lib/email/parse-imap-fetched-message";
import { resolveSentMailboxPath } from "@/lib/email/resolve-sent-mailbox";
import { resolveTrashMailboxPath } from "@/lib/email/resolve-trash-mailbox";

const SOURCE_MAX_LENGTH = 12_000_000;

export type FetchedImapAttachment = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  content: Buffer;
};

export async function fetchImapAttachmentServer(input: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  accessToken?: string;
  folder?: ImapFolderKind;
  uid: number;
  filename?: string;
  index?: number;
}): Promise<FetchedImapAttachment | null> {
  const host = normalizeMailHost(input.host);
  const user = input.user.trim();
  const pass = input.pass ?? "";
  const accessToken = input.accessToken;
  const uid = Math.floor(input.uid);

  if (!host || !user) throw new Error("IMAP host and username are required.");
  if (!accessToken && !pass) {
    throw new Error(
      "IMAP credentials missing. For Google Workspace, reconnect with Sign in with Google in Settings → Email.",
    );
  }
  if (!Number.isFinite(uid) || uid <= 0) throw new Error("A valid IMAP UID is required.");

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
    const rows = await client.fetchAll(
      [uid],
      { uid: true, source: { maxLength: SOURCE_MAX_LENGTH } },
      { uid: true },
    );
    const row = rows[0];
    if (!row?.source?.length) return null;
    const parsed = await parseMailSourceFields(row.source);
    const wantedName = input.filename?.trim().toLowerCase();
    const byName = wantedName
      ? parsed.attachments.find((att) => att.filename.trim().toLowerCase() === wantedName)
      : undefined;
    const byIndex =
      typeof input.index === "number" && Number.isFinite(input.index)
        ? parsed.attachments[Math.floor(input.index)]
        : undefined;
    const match = byName ?? byIndex ?? parsed.attachments[0];
    if (match?.contentBase64) {
      return {
        filename: match.filename,
        mimeType: match.mimeType,
        sizeBytes: match.sizeBytes,
        content: Buffer.from(match.contentBase64, "base64"),
      };
    }

    const { simpleParser } = await import("mailparser");
    const full = await simpleParser(row.source);
    const parts = full.attachments ?? [];
    const part =
      (wantedName
        ? parts.find((att) => (att.filename ?? "").trim().toLowerCase() === wantedName)
        : undefined) ??
      (typeof input.index === "number" && Number.isFinite(input.index)
        ? parts[Math.floor(input.index)]
        : undefined) ??
      parts[0];
    if (!part) return null;
    const buf = Buffer.isBuffer(part.content) ? part.content : Buffer.from(part.content ?? []);
    if (!buf.length) return null;
    return {
      filename: part.filename?.trim() || match?.filename || "attachment",
      mimeType: part.contentType || match?.mimeType || "application/octet-stream",
      sizeBytes: buf.length,
      content: buf,
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

export function toImapAttachmentErrorMessage(e: unknown): string {
  return formatImapError(e);
}
