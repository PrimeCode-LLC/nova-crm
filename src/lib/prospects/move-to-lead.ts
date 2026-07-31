import { isProspectRow } from "@/lib/prospects/prospect-access";
import type { Lead } from "@/lib/types";

/**
 * Whether this prospect can be promoted in-place to a sales lead.
 * Channel-pushed prospects already have a linked sales lead — open that instead.
 */
export function canMoveToLead(lead: Lead): boolean {
  return isProspectRow(lead);
}

export function moveToLeadBlockedReason(lead: Lead): string | null {
  if (!isProspectRow(lead)) {
    return "This record is already a sales lead.";
  }
  if (lead.linkedSalesLeadId?.trim()) {
    return "This prospect already has a sales lead from a channel push. Open that lead instead.";
  }
  return null;
}

export function moveToLeadConfirmCopy(): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  return {
    title: "Move to lead?",
    description:
      "This promotes the prospect into the sales pipeline. It will leave Prospects and appear under Leads. You can move it back later if needed.",
    confirmLabel: "Move to lead",
  };
}

/** Patch applied when manually promoting a prospect to a sales lead. */
export function buildMoveToLeadPatch(input: {
  lead: Pick<Lead, "ownerId">;
  actorId: string;
  now?: string;
}): Partial<Lead> {
  const now = input.now ?? new Date().toISOString();
  const ownerPatch =
    !input.lead.ownerId?.trim() && input.actorId ? { ownerId: input.actorId } : {};
  return {
    intakeKind: undefined,
    lastActivityAt: now,
    ...ownerPatch,
  };
}
