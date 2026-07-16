import { getDashboardRangeStart, type DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import type { Followup, FollowupPlan, Lead, LeadTask } from "@/lib/types";

export type DashboardWorkflowMetrics = {
  openSalesLeads: number;
  idleSalesLeads: number;
  prospects: number;
  prospectsNeedRouting: number;
  prospectsPushed: number;
  followupsDue: number;
  overdueFollowups: number;
  scheduledSteps: number;
  readyUnscheduledSteps: number;
  sentInRange: number;
  failedDeliveries: number;
  activeSequences: number;
  remainingSequenceSteps: number;
  pausedOnReply: number;
  myOpenTasks: number;
  overdueTasks: number;
  waitingOnOthers: number;
};

function validTime(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : undefined;
}

export function isSalesLead(lead: Lead): boolean {
  return lead.intakeKind !== "prospect";
}

export function prospectNeedsRouting(lead: Lead): boolean {
  if (lead.intakeKind !== "prospect") return false;
  const assignments = lead.prospectChannelAssignments ?? [];
  return assignments.length === 0 || assignments.some((assignment) => !assignment.pushedAt);
}

export function computeDashboardWorkflowMetrics(input: {
  leads: readonly Lead[];
  followups: readonly Followup[];
  plans: readonly FollowupPlan[];
  tasks: readonly LeadTask[];
  currentUserId: string;
  range: DashboardTimeRangeKey;
  now?: Date;
}): DashboardWorkflowMetrics {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const start = getDashboardRangeStart(input.range, now).getTime();

  const salesLeads = input.leads.filter(isSalesLead);
  const prospects = input.leads.filter((lead) => lead.intakeKind === "prospect");
  const actionableFollowups = input.followups.filter((followup) => !followup.completedAt && !followup.pausedAt);
  const dueFollowups = actionableFollowups.filter((followup) => {
    const due = validTime(followup.dueAt);
    return due !== undefined && due <= endOfToday.getTime();
  });
  const activePlanIds = new Set(
    input.plans.filter((plan) => plan.status === "active").map((plan) => plan.id),
  );
  const openTasks = input.tasks.filter((task) => !task.completedAt);

  return {
    openSalesLeads: salesLeads.filter((lead) => !["won", "lost"].includes(lead.stage)).length,
    idleSalesLeads: salesLeads.filter(
      (lead) => lead.isIdle && !["won", "lost"].includes(lead.stage),
    ).length,
    prospects: prospects.length,
    prospectsNeedRouting: prospects.filter(prospectNeedsRouting).length,
    prospectsPushed: prospects.filter((lead) => Boolean(lead.linkedSalesLeadId)).length,
    followupsDue: dueFollowups.length,
    overdueFollowups: dueFollowups.filter((followup) => {
      const due = validTime(followup.dueAt);
      return due !== undefined && due < nowMs;
    }).length,
    scheduledSteps: actionableFollowups.filter(
      (followup) => followup.deliveryStatus === "scheduled" || Boolean(followup.scheduledEmailId),
    ).length,
    readyUnscheduledSteps: actionableFollowups.filter(
      (followup) =>
        Boolean(followup.messageBody?.trim()) &&
        !followup.scheduledEmailId &&
        followup.deliveryStatus !== "sent",
    ).length,
    sentInRange: input.followups.filter((followup) => {
      const sent = validTime(followup.sentAt);
      return followup.deliveryStatus === "sent" && sent !== undefined && sent >= start;
    }).length,
    failedDeliveries: input.followups.filter(
      (followup) => followup.deliveryStatus === "failed" && !followup.completedAt,
    ).length,
    activeSequences: activePlanIds.size,
    remainingSequenceSteps: actionableFollowups.filter(
      (followup) => Boolean(followup.planId && activePlanIds.has(followup.planId)),
    ).length,
    pausedOnReply: input.plans.filter(
      (plan) => plan.status === "paused" && Boolean(plan.replyMessageId),
    ).length,
    myOpenTasks: openTasks.filter((task) => task.assigneeId === input.currentUserId).length,
    overdueTasks: openTasks.filter((task) => {
      const due = validTime(task.dueAt);
      return task.assigneeId === input.currentUserId && due !== undefined && due < nowMs;
    }).length,
    waitingOnOthers: openTasks.filter(
      (task) =>
        task.createdById === input.currentUserId && task.assigneeId !== input.currentUserId,
    ).length,
  };
}
