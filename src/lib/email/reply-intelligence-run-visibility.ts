import type { Lead } from "@/lib/types";

/** True when a reply exists but reply intelligence is not actively pending. */
export function shouldOfferReplyIntelligenceRun(lead: Lead): boolean {
  const hasReplySignal = Boolean(
    lead.lastReplyAt ||
      lead.lastInboundEmailAt ||
      lead.lastAutoReplyAt ||
      lead.replyReviewStatus === "pending",
  );
  if (!hasReplySignal) return false;

  const pending =
    Boolean(lead.pendingReplyActionId?.trim()) && lead.replyActionStatus === "pending";
  if (pending) return false;

  // Already classified and resolved (accepted / sent) with a next action — don't nag.
  if (
    lead.replyClass &&
    (lead.replyActionStatus === "accepted" || lead.replyActionStatus === "sent") &&
    Boolean(lead.nextAction?.trim())
  ) {
    return false;
  }

  // Missed classify, dismissed, expired, or empty next step after a reply.
  return (
    !lead.replyClass ||
    lead.replyActionStatus === "dismissed" ||
    lead.replyActionStatus === "expired" ||
    !lead.nextAction?.trim() ||
    lead.replyReviewStatus === "pending"
  );
}
