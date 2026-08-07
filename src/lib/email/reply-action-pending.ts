import type { Lead } from "@/lib/types";
import type { ReplyClass, ReplyRecommendedAction } from "@/lib/email/reply-action-types";

/** Lead has an open reply-intelligence action waiting for send / confirm / dismiss. */
export function hasPendingReplyAction(lead: Lead): boolean {
  return Boolean(lead.pendingReplyActionId?.trim()) && lead.replyActionStatus === "pending";
}

/** Hard no / unsubscribe — stop pursuing, do not promote into the pipeline. */
export function isReplyActionCloseLost(input: {
  classification?: ReplyClass | Lead["replyClass"] | null;
  recommendedAction?: ReplyRecommendedAction | null;
}): boolean {
  return input.classification === "hard_no" || input.recommendedAction === "close_lost";
}

/**
 * Mechanical "promote / move to Replied" is wrong for hard-no classifications.
 * Hide that banner whenever the latest reply class is hard_no (AI owns the decision).
 */
export function shouldSuppressReplyReviewForHardNo(lead: Pick<Lead, "replyClass">): boolean {
  return isReplyActionCloseLost({ classification: lead.replyClass });
}
