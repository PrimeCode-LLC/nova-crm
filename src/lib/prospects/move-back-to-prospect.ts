import { STAGES_BY_KEY } from "@/lib/constants";
import { isProspectRow } from "@/lib/prospects/prospect-access";
import type { Lead, PipelineStage } from "@/lib/types";

/** Early pipeline stages where an accidental promote/push is still safe to undo. */
export const MOVE_BACK_SAFE_STAGES: readonly PipelineStage[] = [
  "new",
  "viewed",
  "contacted",
  "replied",
];

export type MoveBackMode = "demote_inplace" | "unpush_sales_lead";

/**
 * Whether this sales lead can be moved back to prospect, and how.
 * - `unpush_sales_lead`: channel push created a sibling sales row
 * - `demote_inplace`: same row was promoted (reply review / record type)
 */
export function moveBackModeFor(lead: Lead): MoveBackMode | null {
  if (isProspectRow(lead)) return null;
  if (lead.prospectSourceId?.trim()) return "unpush_sales_lead";
  if (
    Boolean(lead.prospectOwnerId?.trim()) ||
    (lead.prospectChannelAssignments?.length ?? 0) > 0
  ) {
    return "demote_inplace";
  }
  return null;
}

export function moveBackBlockedReason(
  lead: Lead,
  opts?: { hasDeal?: boolean },
): string | null {
  if (moveBackModeFor(lead) == null) {
    return "This record was not promoted from a prospect.";
  }
  if (!MOVE_BACK_SAFE_STAGES.includes(lead.stage)) {
    const label = STAGES_BY_KEY[lead.stage]?.label ?? lead.stage;
    return `This lead is at ${label}. Archive it instead of moving it back to prospect.`;
  }
  if ((lead.touches ?? 0) > 0) {
    return "This lead already has touchpoints logged. Archive it instead of moving it back.";
  }
  if (opts?.hasDeal) {
    return "This lead has a deal attached. Archive it instead of moving it back.";
  }
  return null;
}

export function moveBackConfirmCopy(mode: MoveBackMode): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  if (mode === "unpush_sales_lead") {
    return {
      title: "Move back to prospect?",
      description:
        "This removes the sales lead created from the prospect push and restores the original prospect so channels can be pushed again. Notes on this sales lead will no longer appear.",
      confirmLabel: "Move back to prospect",
    };
  }
  return {
    title: "Move back to prospect?",
    description:
      "This returns the record to Prospects (intake) and resets the stage to New. It will leave the sales pipeline.",
    confirmLabel: "Move back to prospect",
  };
}
