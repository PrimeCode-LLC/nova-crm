import type { Lead } from "@/lib/types";

/** Lead has an open reply-intelligence action waiting for send / confirm / dismiss. */
export function hasPendingReplyAction(lead: Lead): boolean {
  return Boolean(lead.pendingReplyActionId?.trim()) && lead.replyActionStatus === "pending";
}
