import { STAGES_BY_KEY } from "@/lib/constants";
import { isProspectRow } from "@/lib/prospects/prospect-access";
import type { Lead, PipelineStage } from "@/lib/types";

/** Early pipeline stages where move-back is allowed (with optional strong confirm). */
export const MOVE_BACK_SAFE_STAGES: readonly PipelineStage[] = [
  "new",
  "viewed",
  "contacted",
  "replied",
];

export type MoveBackMode = "demote_inplace" | "unpush_sales_lead";

export type MoveBackActivity = {
  touches: number;
  openFollowups: number;
  hasActiveSequence: boolean;
};

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

/** Hard blocks only — activity (touches / follow-ups) uses a stronger confirm instead. */
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
  if (opts?.hasDeal) {
    return "This lead has a deal attached. Archive it instead of moving it back.";
  }
  return null;
}

export function moveBackHasActivity(activity: MoveBackActivity): boolean {
  return (
    activity.touches > 0 ||
    activity.openFollowups > 0 ||
    activity.hasActiveSequence
  );
}

export function moveBackConfirmCopy(
  mode: MoveBackMode,
  activity?: MoveBackActivity,
): {
  title: string;
  description: string;
  confirmLabel: string;
  requiresAck: boolean;
  ackLabel: string;
} {
  const hasActivity = activity ? moveBackHasActivity(activity) : false;
  const activityBits: string[] = [];
  if (activity) {
    if (activity.touches > 0) {
      activityBits.push(
        `${activity.touches} outreach touch${activity.touches === 1 ? "" : "es"}`,
      );
    }
    if (activity.openFollowups > 0) {
      activityBits.push(
        `${activity.openFollowups} open follow-up${activity.openFollowups === 1 ? "" : "s"}`,
      );
    }
    if (activity.hasActiveSequence) {
      activityBits.push("an active/paused email sequence");
    }
  }
  const activityLine =
    activityBits.length > 0
      ? ` This lead already has ${activityBits.join(", ")}. Open follow-ups and scheduled emails will be cancelled.`
      : "";

  if (mode === "unpush_sales_lead") {
    return {
      title: hasActivity ? "Move back and cancel outreach?" : "Move back to prospect?",
      description:
        "This removes the sales lead created from the prospect push and restores the original prospect so channels can be pushed again." +
        activityLine +
        " Notes on this sales lead will no longer appear.",
      confirmLabel: hasActivity ? "Cancel outreach & move back" : "Move back to prospect",
      requiresAck: hasActivity,
      ackLabel: "I understand open follow-ups and scheduled emails will be cancelled.",
    };
  }
  return {
    title: hasActivity ? "Move back and cancel outreach?" : "Move back to prospect?",
    description:
      "This returns the record to Prospects (intake) and resets the stage to New. It will leave the sales pipeline." +
      activityLine,
    confirmLabel: hasActivity ? "Cancel outreach & move back" : "Move back to prospect",
    requiresAck: hasActivity,
    ackLabel: "I understand open follow-ups and scheduled emails will be cancelled.",
  };
}
