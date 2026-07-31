import type { EmailMailboxSettings, MailInbound } from "@/lib/email-account-types";
import { splitComposerReplyBody } from "@/lib/email/compose-draft-text";
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

/** Primary From address for a mailbox (emailAddress, else IMAP user). */
export function mailboxPrimaryAddress(account: EmailMailboxSettings): string {
  return (
    extractReplyAddress(account.emailAddress).toLowerCase() ||
    extractReplyAddress(account.imap.user).toLowerCase()
  );
}

/** Append an address to a comma-separated recipient line without duplicates. */
export function appendRecipientAddress(line: string, address: string): string {
  const email = extractReplyAddress(address).toLowerCase();
  if (!email) return line.trim();
  const existing = extractEmailAddresses(line);
  if (existing.has(email)) return line.trim();
  const trimmed = line.trim();
  return trimmed ? `${trimmed}, ${email}` : email;
}

/** Remove mailbox identities from a recipient line. */
export function withoutMailboxIdentities(
  line: string,
  account: EmailMailboxSettings,
): string {
  const mine = mailboxIdentityEmails(account);
  if (mine.size === 0) return line.trim();
  const kept = [...extractEmailAddresses(line)].filter((email) => !mine.has(email));
  return kept.join(", ");
}

/**
 * When changing From on a reply, keep the previous mailbox on Cc (handoff)
 * and strip the new mailbox’s identities from Cc.
 */
export function applyMailboxHandoffCc(input: {
  to: string;
  cc: string;
  previousMailbox: EmailMailboxSettings;
  nextMailbox: EmailMailboxSettings;
}): { cc: string; added: string | null } {
  const previous = mailboxPrimaryAddress(input.previousMailbox);
  const next = mailboxPrimaryAddress(input.nextMailbox);
  if (!previous || previous === next) {
    return {
      cc: withoutMailboxIdentities(input.cc, input.nextMailbox),
      added: null,
    };
  }

  const alreadyVisible = extractEmailAddresses(input.to, input.cc);
  let cc = withoutMailboxIdentities(input.cc, input.nextMailbox);
  let added: string | null = null;
  if (!alreadyVisible.has(previous)) {
    cc = appendRecipientAddress(cc, previous);
    added = previous;
  }
  return { cc, added };
}

/**
 * Rebuild compose body with a new mailbox signature while preserving
 * the user draft and quoted/forwarded trailer.
 */
export function rebuildComposeBodyWithMailboxSignature(
  body: string,
  nextSignature: string | undefined,
): string {
  const { userDraft } = splitComposerReplyBody(body);
  const normalized = (body ?? "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  let quoteIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (
      /^\s*-{3,}\s*$/.test(line) ||
      /^\s*-{2,}\s*original message\s*-{2,}\s*$/i.test(line) ||
      /^\s*-{2,}\s*forwarded message\s*-{2,}\s*$/i.test(line)
    ) {
      quoteIdx = i;
      break;
    }
    if (/^\s*(on|le|el|am)\b.{0,240}\bwrote:\s*$/i.test(line)) {
      quoteIdx = i;
      break;
    }
  }
  const quote = quoteIdx >= 0 ? lines.slice(quoteIdx).join("\n").trim() : "";
  const sig = nextSignature?.trim() ?? "";
  const chunks: string[] = [];
  if (userDraft.trim()) chunks.push(userDraft.trim());
  if (sig) chunks.push(sig);
  if (quote) chunks.push(quote);
  if (chunks.length === 0) return "";
  return `\n\n${chunks.join("\n\n")}`;
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
