import type { Followup, FollowupPlan, Lead } from "@/lib/types";

export function getActiveFollowupPlanForLead(
  plans: readonly FollowupPlan[],
  leadId: string,
): FollowupPlan | undefined {
  return plans
    .filter((p) => p.leadId === leadId && p.status === "active")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
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
  return [...stored, ...synth];
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
