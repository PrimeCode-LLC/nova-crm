"use client";

/** Browser event so Emails tab / timeline can refresh after AI approve & send. */
export const LEAD_REPLY_SENT_EVENT = "crm:lead-reply-sent";

/** Inbound reply stamped — Emails tab + heads hydrate should refresh immediately. */
export const LEAD_REPLY_RECEIVED_EVENT = "crm:lead-reply-received";

/** Force a cheap Firestore heads hydrate (no IMAP) across open tabs. */
export const INBOX_HEADS_REFRESH_EVENT = "crm:inbox-heads-refresh";

export type LeadReplySentDetail = {
  leadId: string;
  subject?: string;
  messageId?: string;
  body?: string;
  to?: string;
  from?: string;
  mailboxId?: string;
  mailboxOwnerUid?: string;
  sentAt?: string;
  inReplyTo?: string;
  referenceIds?: string[];
};

export type LeadReplyReceivedDetail = {
  leadId: string;
  /** Store key e.g. `mailboxId:in:messageId` when known from client watcher. */
  replyMessageId?: string;
  source?: "imap" | "instantly" | "manual" | "server";
};

/** Holds the latest send briefly so Emails tab can pick it up after mount. */
let pendingLeadReplySent: LeadReplySentDetail | null = null;

/** Holds the latest inbound stamp briefly so Emails tab can pick it up after mount. */
let pendingLeadReplyReceived: LeadReplyReceivedDetail | null = null;

export function dispatchLeadReplySent(detail: LeadReplySentDetail): void {
  pendingLeadReplySent = detail;
  if (typeof window === "undefined") return;
  // Defer so tab switches / panel mount can subscribe first.
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(LEAD_REPLY_SENT_EVENT, { detail }));
  }, 0);
}

/** Consume a pending send for this lead (clears after read). */
export function takePendingLeadReplySent(leadId: string): LeadReplySentDetail | null {
  if (!pendingLeadReplySent || pendingLeadReplySent.leadId !== leadId) return null;
  const detail = pendingLeadReplySent;
  pendingLeadReplySent = null;
  return detail;
}

export function dispatchLeadReplyReceived(detail: LeadReplyReceivedDetail): void {
  pendingLeadReplyReceived = detail;
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(LEAD_REPLY_RECEIVED_EVENT, { detail }));
    window.dispatchEvent(new CustomEvent(INBOX_HEADS_REFRESH_EVENT));
  }, 0);
}

/** Consume a pending inbound stamp for this lead (clears after read). */
export function takePendingLeadReplyReceived(leadId: string): LeadReplyReceivedDetail | null {
  if (!pendingLeadReplyReceived || pendingLeadReplyReceived.leadId !== leadId) return null;
  const detail = pendingLeadReplyReceived;
  pendingLeadReplyReceived = null;
  return detail;
}

export function dispatchInboxHeadsRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(INBOX_HEADS_REFRESH_EVENT));
}

export const REPLY_REGENERATE_DIRECTIONS = [
  { id: "shorter", label: "Shorter", hint: "Rewrite shorter: under 60 words, one idea, one soft ask." },
  { id: "softer", label: "Softer", hint: "Rewrite softer and lower-pressure. No meeting ask unless they invited one." },
  {
    id: "no_meeting",
    label: "No meeting ask",
    hint: "Do not ask for a call or meeting. Keep one low-friction question or leave the door open.",
  },
  {
    id: "close_politely",
    label: "Close politely",
    hint: "Accept their position gracefully, thank them, and close the loop without pitching again.",
  },
  {
    id: "ask_referral",
    label: "Ask referral",
    hint: "If they are not the buyer, politely ask who owns this or whether they can introduce the right person.",
  },
] as const;

export type ReplyRegenerateDirectionId = (typeof REPLY_REGENERATE_DIRECTIONS)[number]["id"];
