"use client";

/** Browser event so Emails tab / timeline can refresh after AI approve & send. */
export const LEAD_REPLY_SENT_EVENT = "crm:lead-reply-sent";

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

/** Holds the latest send briefly so Emails tab can pick it up after mount. */
let pendingLeadReplySent: LeadReplySentDetail | null = null;

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
