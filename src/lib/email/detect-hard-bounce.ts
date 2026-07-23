import { normalizeMessageId } from "@/lib/email/thread-inbound";
import type { MailInbound } from "@/lib/email-account-types";

export type BounceKind = "hard" | "soft";

export type DetectedBounce = {
  bounceKind: BounceKind;
  failedRecipients: string[];
  /** Normalized RFC Message-ID of the original outbound message, when present. */
  originalMessageId?: string;
  reason: string;
};

const DAEMON_FROM_RE =
  /mailer-daemon|mail-daemon|postmaster|mail delivery subsystem|noreply.*bounce/i;

const DSN_SUBJECT_RE =
  /delivery status notification|mail delivery failed|undeliverable|delivery failure|returned mail|failure notice|returned to sender|couldn't be delivered|could not be delivered/i;

const HARD_REASON_RE =
  /address not found|domain .+ could(?:n't| not) be found|user unknown|no such user|mailbox (?:unavailable|does not exist)|recipient rejected|invalid (?:mailbox|recipient)|does not exist|550[-\s]|551[-\s]|553[-\s]|5\.1\.[0-9]|5\.4\.4|permanent(?:ly)?\s+fail|unknown user|not a valid|no mailbox/i;

const SOFT_REASON_RE =
  /mailbox full|over quota|try again later|temporarily|deferred|421[-\s]|450[-\s]|451[-\s]|452[-\s]|4\.2\.2|greylist|out of storage/i;

const FAILED_RECIPIENT_RE = [
  /wasn't delivered to\s+([^\s<>"']+@[^\s<>"']+)/gi,
  /was not delivered to\s+([^\s<>"']+@[^\s<>"']+)/gi,
  /could(?:n't| not) be delivered to\s+([^\s<>"']+@[^\s<>"']+)/gi,
  /delivered to\s+([^\s<>"']+@[^\s<>"']+)/gi,
  /Final-Recipient:\s*(?:rfc822;)\s*([^\s;]+@[^\s;]+)/gi,
  /Original-Recipient:\s*(?:rfc822;)\s*([^\s;]+@[^\s;]+)/gi,
  /X-Failed-Recipients:\s*([^\n\r]+)/gi,
  /The following address(?:es)? failed:\s*([^\s<>"']+@[^\s<>"']+)/gi,
  /<([^\s<>"']+@[^\s<>"']+)>:\s*(?:User unknown|550|host|Domain)/gi,
];

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
}

const ORIGINAL_MESSAGE_ID_RE = [
  /Original-Message-ID:\s*<?([^>\s]+)>?/i,
  /Message-ID of (?:the )?original(?: message)?:\s*<?([^>\s]+)>?/i,
  /in reply to message\s+<?([^>\s]+@[^>\s]+)>?/i,
];

/** True when the message looks like a delivery status / bounce notification (hard or soft). */
export function isDeliveryStatusNotification(
  message: Pick<MailInbound, "from" | "subject" | "preview" | "bodyText">,
): boolean {
  const from = message.from ?? "";
  const subject = message.subject ?? "";
  if (DAEMON_FROM_RE.test(from) || DSN_SUBJECT_RE.test(subject)) return true;
  const blob = `${subject}\n${message.preview ?? ""}\n${message.bodyText ?? ""}`;
  return /delivery status notification|mail delivery failed|undeliverable/i.test(blob);
}

function collectEmails(raw: string): string[] {
  const out = new Set<string>();
  const angle = raw.matchAll(/<?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>?/gi);
  for (const m of angle) {
    const e = m[1]?.trim().toLowerCase();
    if (e) out.add(e);
  }
  return [...out];
}

function extractFailedRecipients(text: string): string[] {
  const out = new Set<string>();
  for (const re of FAILED_RECIPIENT_RE) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      for (const e of collectEmails(m[1] ?? "")) out.add(e);
    }
  }
  return [...out];
}

function extractOriginalMessageId(text: string): string | undefined {
  for (const re of ORIGINAL_MESSAGE_ID_RE) {
    const m = text.match(re);
    if (m?.[1]) {
      const id = normalizeMessageId(m[1]);
      if (id) return id;
    }
  }
  return undefined;
}

function classifyBounceKind(text: string): BounceKind {
  if (SOFT_REASON_RE.test(text) && !HARD_REASON_RE.test(text)) return "soft";
  if (HARD_REASON_RE.test(text)) return "hard";
  // Daemon + DSN subject with no soft signals → treat as hard (Gmail "Address not found").
  return "hard";
}

function extractReason(text: string, kind: BounceKind): string {
  if (kind === "soft") {
    const soft = text.match(SOFT_REASON_RE);
    if (soft?.[0]) return soft[0].trim();
    return "Temporary delivery failure";
  }
  const hard = text.match(HARD_REASON_RE);
  if (hard?.[0]) return hard[0].trim();
  if (/address not found/i.test(text)) return "Address not found";
  return "Permanent delivery failure";
}

/**
 * Detect a hard/soft bounce from an inbound IMAP message (e.g. Gmail mailer-daemon DSN).
 * Returns null when the message is not a delivery status notification.
 */
export function detectHardBounce(
  message: Pick<
    MailInbound,
    | "from"
    | "to"
    | "subject"
    | "preview"
    | "bodyText"
    | "bodyHtml"
    | "inReplyTo"
    | "referenceIds"
    | "messageId"
  >,
): DetectedBounce | null {
  if (!isDeliveryStatusNotification(message)) return null;

  const htmlText = message.bodyHtml ? stripHtml(message.bodyHtml) : "";
  const text = [message.subject, message.preview, message.bodyText, htmlText]
    .filter(Boolean)
    .join("\n");

  const failedRecipients = extractFailedRecipients(text);
  // Fallback: sometimes the failed address only appears in the To of the DSN (rare).
  // Never treat the mailbox owner (DSN To) as the failed recipient when the To is the sender.
  if (failedRecipients.length === 0) {
    /* keep empty - caller should wait for body sync rather than mis-attributing */
  }

  const originalMessageId =
    extractOriginalMessageId(text) ||
    (message.inReplyTo ? normalizeMessageId(message.inReplyTo) : undefined) ||
    (message.referenceIds?.[0] ? normalizeMessageId(message.referenceIds[0]) : undefined);

  const bounceKind = classifyBounceKind(text);
  const reason = extractReason(text, bounceKind);

  return {
    bounceKind,
    failedRecipients: [...new Set(failedRecipients)],
    originalMessageId: originalMessageId || undefined,
    reason,
  };
}

/** Stable Firestore doc id for a bounce event (mailbox + inbound message). */
export function bounceEventDocId(mailboxId: string, inboundMessageId: string): string {
  const raw = `${mailboxId.trim()}_${inboundMessageId.trim()}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 700);
}

export const BOUNCE_REVIEW_TASK_TITLE = "Find valid email (bounced)";
export const BOUNCE_PAUSE_REASON = "Email bounced - invalid address";
