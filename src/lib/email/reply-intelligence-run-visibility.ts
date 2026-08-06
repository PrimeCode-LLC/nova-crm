import type { Lead } from "@/lib/types";

/**
 * Show a manual "detect reply → next step" control unless a pending
 * reply-intelligence action is already attached and visible on this lead.
 */
export function shouldOfferReplyIntelligenceRun(lead: Lead): boolean {
  if (lead.doNotContact) return false;

  const pending =
    Boolean(lead.pendingReplyActionId?.trim()) && lead.replyActionStatus === "pending";
  if (pending) return false;

  return true;
}

/** Stronger empty-state banner when a reply signal exists but NBA is missing. */
export function shouldHighlightMissingReplyNextStep(lead: Lead): boolean {
  if (!shouldOfferReplyIntelligenceRun(lead)) return false;
  const hasReplySignal = Boolean(
    lead.lastReplyAt ||
      lead.lastInboundEmailAt ||
      lead.lastAutoReplyAt ||
      lead.replyReviewStatus === "pending" ||
      lead.replyClass ||
      (lead.emailMailCount ?? 0) > 0,
  );
  if (!hasReplySignal) return false;
  return !lead.nextAction?.trim() || !lead.pendingReplyActionId?.trim();
}
