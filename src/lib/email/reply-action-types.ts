import type { ISODate } from "@/lib/types";

/** Structured inbound reply classes for Next Best Action. */
export type ReplyClass =
  | "auto_reply"
  | "positive"
  | "meeting_ready"
  | "neutral"
  | "objection"
  | "soft_no"
  | "hard_no"
  | "unclear";

export type ReplyRecommendedAction =
  | "reply_now"
  | "schedule_followup"
  | "book_meeting"
  | "nurture"
  | "close_lost"
  | "ignore"
  | "wait";

export type ReplyActionStatus = "pending" | "accepted" | "dismissed" | "expired" | "sent";

export type ReplyAction = {
  id: string;
  organizationId: string;
  leadId: string;
  mailboxId: string;
  /** Owner of the mailbox used for drafts/sends (may differ from Instantly stub). */
  mailboxOwnerUid?: string;
  inboundProviderKey: string;
  status: ReplyActionStatus;
  classification: ReplyClass;
  potentialScore: number;
  recommendedAction: ReplyRecommendedAction;
  rationale: string;
  nextStepSummary: string;
  draftSubject?: string;
  draftBody?: string;
  draftTo?: string;
  draftInReplyTo?: string;
  draftReferenceIds?: string[];
  /** Snippet of the inbound message this draft replies to (for approval UI). */
  inboundPreview?: string;
  inboundFrom?: string;
  inboundSubject?: string;
  draftStatus?: "none" | "pending" | "ready" | "failed";
  draftError?: string;
  sentAt?: ISODate;
  sentMessageId?: string;
  source: "imap" | "instantly" | "client_sync" | "manual" | "system";
  createdAt: ISODate;
  updatedAt: ISODate;
  decidedAt?: ISODate;
  decidedBy?: string;
};

export const REPLY_CLASS_LABELS: Record<ReplyClass, string> = {
  auto_reply: "Auto-reply",
  positive: "Positive",
  meeting_ready: "Ready to meet",
  neutral: "Neutral",
  objection: "Objection",
  soft_no: "Soft no",
  hard_no: "Hard no",
  unclear: "Unclear",
};

/** Classes/actions that should get an AI draft for human approve-and-send. */
export function replyActionNeedsDraft(input: {
  classification: ReplyClass;
  recommendedAction: ReplyRecommendedAction;
}): boolean {
  if (
    input.classification === "auto_reply" ||
    input.classification === "hard_no" ||
    input.recommendedAction === "ignore" ||
    input.recommendedAction === "wait" ||
    input.recommendedAction === "close_lost" ||
    input.recommendedAction === "schedule_followup"
  ) {
    return false;
  }
  return (
    input.recommendedAction === "reply_now" ||
    input.recommendedAction === "book_meeting" ||
    input.recommendedAction === "nurture" ||
    input.classification === "positive" ||
    input.classification === "meeting_ready" ||
    input.classification === "neutral" ||
    input.classification === "objection" ||
    input.classification === "soft_no"
  );
}

export function draftGoalForReplyAction(input: {
  classification: ReplyClass;
  recommendedAction: ReplyRecommendedAction;
  nextStepSummary: string;
}): string {
  if (input.recommendedAction === "book_meeting" || input.classification === "meeting_ready") {
    return "Confirm interest and propose a short meeting or ask for their availability";
  }
  if (input.classification === "objection" || input.classification === "soft_no") {
    return `Address their reply with a sharp, respectful rebuttal. Goal: ${input.nextStepSummary}`;
  }
  if (input.recommendedAction === "nurture") {
    return "Light, helpful reply that keeps the door open without pressure";
  }
  return input.nextStepSummary.trim() || "Reply thoughtfully and advance toward a clear next step";
}

export function formatReplyNextAction(input: {
  classification: ReplyClass;
  nextStepSummary: string;
  potentialScore?: number;
}): string {
  const label = REPLY_CLASS_LABELS[input.classification];
  const score =
    typeof input.potentialScore === "number" && input.classification !== "auto_reply"
      ? ` · potential ${Math.round(input.potentialScore)}`
      : "";
  const step = input.nextStepSummary.trim();
  return step ? `${label}${score}: ${step}` : `${label}${score}`;
}
