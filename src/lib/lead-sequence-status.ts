import type { Followup, FollowupPlan, Lead } from "@/lib/types";
import {
  canAutoScheduleFollowupEmail,
  followupsForPlan,
  getActiveFollowupPlanForLead,
  getPausedFollowupPlanForLead,
} from "@/lib/followup-plans";

/**
 * Derived outreach workflow status for a lead's current sequence.
 * Prefer active → paused → latest completed; superseded plans are ignored.
 */
export type LeadSequenceStatus =
  | "no_sequence"
  | "needs_schedule"
  | "scheduled"
  | "completed"
  | "paused"
  | "needs_attention";

export const LEAD_SEQUENCE_STATUS_OPTIONS = [
  { key: "no_sequence", label: "No sequence" },
  { key: "needs_schedule", label: "Needs schedule" },
  { key: "scheduled", label: "Scheduled" },
  { key: "completed", label: "Completed" },
  { key: "paused", label: "Paused" },
  { key: "needs_attention", label: "Needs attention" },
] as const satisfies ReadonlyArray<{ key: LeadSequenceStatus; label: string }>;

export const LEAD_SEQUENCE_STATUS_LABEL: Record<LeadSequenceStatus, string> =
  Object.fromEntries(
    LEAD_SEQUENCE_STATUS_OPTIONS.map((o) => [o.key, o.label]),
  ) as Record<LeadSequenceStatus, string>;

/** Outline badge classes for the leads table Sequence column. */
export const LEAD_SEQUENCE_STATUS_TONE: Record<LeadSequenceStatus, string> = {
  no_sequence: "bg-muted text-muted-foreground border-border",
  needs_schedule: "bg-amber-500/10 text-amber-800 border-amber-500/25 dark:text-amber-200",
  scheduled: "bg-sky-500/10 text-sky-800 border-sky-500/25 dark:text-sky-200",
  completed: "bg-emerald-500/10 text-emerald-800 border-emerald-500/25 dark:text-emerald-200",
  paused: "bg-violet-500/10 text-violet-800 border-violet-500/25 dark:text-violet-200",
  needs_attention: "bg-destructive/10 text-destructive border-destructive/25",
};

function latestCompletedPlanForLead(
  plans: readonly FollowupPlan[],
  leadId: string,
): FollowupPlan | undefined {
  return plans
    .filter((p) => p.leadId === leadId && p.status === "completed")
    .sort((a, b) =>
      (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt),
    )[0];
}

function hasDeliveryNeedsAttention(steps: readonly Followup[]): boolean {
  return steps.some(
    (s) =>
      !s.completedAt &&
      (s.deliveryStatus === "failed" || s.deliveryStatus === "needs_retry"),
  );
}

function hasQueuedEmailSteps(steps: readonly Followup[]): boolean {
  return steps.some(
    (s) =>
      !s.completedAt &&
      !s.pausedAt &&
      (Boolean(s.scheduledEmailId) || s.deliveryStatus === "scheduled"),
  );
}

/**
 * Classify where a lead sits in the sequence → schedule → send pipeline.
 * Aligns with bulk-schedule preflight: ready steps use `canAutoScheduleFollowupEmail`.
 */
export function getLeadSequenceStatus(
  lead: Pick<Lead, "id" | "channel">,
  plans: readonly FollowupPlan[],
  followups: readonly Followup[],
): LeadSequenceStatus {
  const active = getActiveFollowupPlanForLead(plans, lead.id);
  if (active) {
    const steps = followupsForPlan(followups, active.id);
    if (hasDeliveryNeedsAttention(steps)) return "needs_attention";

    const open = steps.filter((s) => !s.completedAt && !s.pausedAt);
    if (open.some((f) => canAutoScheduleFollowupEmail(f, lead.channel))) {
      return "needs_schedule";
    }
    if (hasQueuedEmailSteps(open) || open.length > 0) {
      return "scheduled";
    }
    // Active plan with every step finished — treat as done until merge reconciles.
    return "completed";
  }

  if (getPausedFollowupPlanForLead(plans, lead.id)) return "paused";

  if (latestCompletedPlanForLead(plans, lead.id)) return "completed";

  return "no_sequence";
}

/** Precompute status for many leads (table filter / column). */
export function buildLeadSequenceStatusMap(
  leads: readonly Pick<Lead, "id" | "channel">[],
  plans: readonly FollowupPlan[],
  followups: readonly Followup[],
): Map<string, LeadSequenceStatus> {
  const map = new Map<string, LeadSequenceStatus>();
  for (const lead of leads) {
    map.set(lead.id, getLeadSequenceStatus(lead, plans, followups));
  }
  return map;
}
