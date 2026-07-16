import type { ChannelKey, Followup, FollowupChannel, FollowupPlan, Lead } from "@/lib/types";

export function getActiveFollowupPlanForLead(
  plans: readonly FollowupPlan[],
  leadId: string,
): FollowupPlan | undefined {
  return plans
    .filter((p) => p.leadId === leadId && p.status === "active")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/** Channels where we queue SMTP send; others stay copy + due-date reminders. */
const REMIND_ONLY_CHANNELS = new Set<ChannelKey>([
  "linkedin_outbound",
  "linkedin_1to1",
  "upwork",
  "job_apply",
]);

export function resolveFollowupChannel(
  channel: FollowupChannel | undefined,
  leadChannel: ChannelKey,
): ChannelKey {
  if (!channel || channel === "other") return leadChannel;
  return channel;
}

/** True when this step can be auto-scheduled as outbound email. */
export function canAutoScheduleFollowupEmail(
  f: Followup,
  leadChannel: ChannelKey,
): boolean {
  if (!f.messageBody?.trim()) return false;
  if (f.scheduledEmailId || f.pausedAt || f.completedAt) return false;
  const resolved = resolveFollowupChannel(f.channel, leadChannel);
  return !REMIND_ONLY_CHANNELS.has(resolved);
}

export function sequenceModeLabel(mode: FollowupPlan["sequenceMode"]): string {
  if (mode === "continue") return "Continue";
  if (mode === "full") return "Full outreach";
  return "Sequence";
}

export function getPausedFollowupPlanForLead(
  plans: readonly FollowupPlan[],
  leadId: string,
): FollowupPlan | undefined {
  return plans
    .filter((p) => p.leadId === leadId && p.status === "paused")
    .sort((a, b) => (b.pausedAt ?? b.createdAt).localeCompare(a.pausedAt ?? a.createdAt))[0];
}

export function followupsForPlan(followups: readonly Followup[], planId: string): Followup[] {
  return followups.filter((f) => f.planId === planId);
}

export function openFollowupsForPlan(followups: readonly Followup[], planId: string): Followup[] {
  return followupsForPlan(followups, planId).filter((f) => !f.completedAt && !f.pausedAt);
}

export function pausedFollowupsForPlan(followups: readonly Followup[], planId: string): Followup[] {
  return followupsForPlan(followups, planId).filter((f) => !f.completedAt && f.pausedAt);
}

/** Plans referenced by follow-ups but missing a plan row (legacy AI batch). */
export function synthesizePlansFromFollowups(
  followups: readonly Followup[],
  existingPlans: readonly FollowupPlan[],
): FollowupPlan[] {
  const known = new Set(existingPlans.map((p) => p.id));
  const out: FollowupPlan[] = [];
  const byPlan = new Map<string, Followup[]>();
  for (const f of followups) {
    if (!f.planId || !f.leadId || known.has(f.planId)) continue;
    const list = byPlan.get(f.planId) ?? [];
    list.push(f);
    byPlan.set(f.planId, list);
  }
  for (const [planId, items] of byPlan) {
    const leadId = items[0]?.leadId;
    const ownerId = items[0]?.ownerId;
    if (!leadId || !ownerId) continue;
    const earliest = items.reduce((min, f) => (f.dueAt < min ? f.dueAt : min), items[0].dueAt);
    out.push({
      id: planId,
      leadId,
      ownerId,
      status: items.some((f) => !f.completedAt && !f.pausedAt) ? "active" : "completed",
      planSummary: "Follow-up plan",
      kind: "sequence",
      createdAt: earliest,
    });
    known.add(planId);
  }
  return out;
}

export function mergeFollowupPlans(
  stored: readonly FollowupPlan[],
  followups: readonly Followup[],
): FollowupPlan[] {
  const synth = synthesizePlansFromFollowups(followups, stored);
  const reconciled = stored.map((plan) => {
    if (plan.status !== "active") return plan;
    const steps = followupsForPlan(followups, plan.id);
    if (steps.length === 0 || steps.some((step) => !step.completedAt && step.deliveryStatus !== "sent")) {
      return plan;
    }
    const completedAt = steps
      .map((step) => step.completedAt ?? step.sentAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    return { ...plan, status: "completed" as const, completedAt };
  });
  return [...reconciled, ...synth];
}

export function leadContactEmails(lead: Lead, contactEmail?: string | null): string[] {
  const emails = new Set<string>();
  const add = (v?: string | null) => {
    const e = v?.trim().toLowerCase();
    if (e && e.includes("@")) emails.add(e);
  };
  add(lead.contactEmail);
  add(contactEmail);
  return [...emails];
}
