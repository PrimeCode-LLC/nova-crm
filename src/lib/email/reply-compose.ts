import type { EmailMailboxSettings, MailInbound } from "@/lib/email-account-types";
import { conversationSubject, normalizeMessageId } from "@/lib/email/thread-inbound";

export type MailReplyContext = {
  inReplyTo?: string;
  referenceIds?: string[];
};

export function extractReplyAddress(fromHeader: string): string {
  const angle = fromHeader.match(/<([^>]+)>/);
  if (angle?.[1]) return angle[1].trim();
  const bare = fromHeader.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  return bare?.[0]?.trim() ?? "";
}

export function extractEmailAddresses(...headers: Array<string | undefined>): Set<string> {
  const addresses = new Set<string>();
  for (const header of headers) {
    for (const value of header?.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? []) {
      addresses.add(value.toLowerCase());
    }
  }
  return addresses;
}

export function replyRecipientAddress(
  message: Pick<MailInbound, "from" | "replyTo">,
): string {
  return extractReplyAddress(message.replyTo || message.from);
}

function mailboxIdentityEmails(account: EmailMailboxSettings): Set<string> {
  const identities = new Set<string>();
  for (const raw of [account.emailAddress, account.imap.user, account.replyTo]) {
    const email = extractReplyAddress(String(raw ?? "")).toLowerCase();
    if (email) identities.add(email);
  }
  return identities;
}

/** Reply-all recipients: sender in To; other participants in Cc, excluding the active mailbox. */
export function replyAllRecipientLine(
  message: MailInbound,
  account: EmailMailboxSettings,
): { to: string; cc: string } {
  const sender = replyRecipientAddress(message);
  if (!sender) return { to: "", cc: "" };

  const mine = mailboxIdentityEmails(account);
  const pool = new Set<string>();
  const collect = (header: string | undefined) => {
    for (const value of header?.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? []) {
      pool.add(value.toLowerCase());
    }
  };
  collect(message.to);
  collect(message.cc);
  collect(message.from);

  pool.delete(sender.toLowerCase());
  for (const identity of mine) pool.delete(identity);
  return { to: sender, cc: [...pool].join(", ") };
}

export function replySubject(subject: string | undefined): string {
  const normalized = conversationSubject(subject);
  if (normalized === "(no subject)") return "Re:";
  return `Re: ${normalized}`;
}

export function forwardSubject(subject: string | undefined): string {
  const normalized = conversationSubject(subject);
  if (normalized === "(no subject)") return "Fwd:";
  return `Fwd: ${normalized}`;
}

export function replyQuotedBody(message: MailInbound): string {
  const original = message.bodyText || message.preview || "";
  return `\n\n---\nOn ${message.date.slice(0, 10)}, ${message.from} wrote:\n${original.slice(0, 4000)}`;
}

export function forwardedBody(message: MailInbound): string {
  const original = message.bodyText || message.preview || "";
  return `\n\n---------- Forwarded message ----------\nFrom: ${message.from}\nDate: ${message.date}\nSubject: ${message.subject}\nTo: ${message.to}${message.cc ? `\nCc: ${message.cc}` : ""}\n\n${original.slice(0, 8000)}`;
}

export function withMailboxSignature(body: string, signature: string | undefined): string {
  const value = signature?.trim();
  return value ? `\n\n${value}${body}` : body;
}

export function replyContextForMessage(
  message: Pick<MailInbound, "messageId" | "inReplyTo" | "referenceIds">,
): MailReplyContext {
  const messageId = normalizeMessageId(message.messageId);
  if (!messageId) return {};
  const references = [
    ...(message.referenceIds ?? []),
    ...(message.inReplyTo ? [message.inReplyTo] : []),
    messageId,
  ]
    .map((value) => normalizeMessageId(value))
    .filter((value): value is string => Boolean(value));
  return {
    inReplyTo: messageId,
    referenceIds: [...new Set(references)].slice(-50),
  };
}
