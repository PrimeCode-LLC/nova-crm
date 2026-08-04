import { getDashboardRangeStart, type DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import { PIPELINE_STAGES } from "@/lib/constants";
import {
  isFollowupActionable,
  isFollowupDueThroughToday,
  isFollowupOverdue,
} from "@/lib/followup-open-status";
import { getLeadSequenceStatus } from "@/lib/lead-sequence-status";
import type { Contact, Followup, FollowupPlan, Lead, LeadTask, PipelineStage } from "@/lib/types";
import { hasPendingReplyReview } from "@/lib/leads/reply-review";
import { BOUNCE_REVIEW_TASK_TITLE } from "@/lib/email/detect-hard-bounce";

const STAGE_ORDER = PIPELINE_STAGES.map((s) => s.key);

function stageAtOrAfterReplied(stage: PipelineStage): boolean {
  const index = STAGE_ORDER.indexOf(stage);
  const repliedIndex = STAGE_ORDER.indexOf("replied");
  return index >= 0 && repliedIndex >= 0 && index >= repliedIndex && stage !== "lost";
}

function leadHasReply(lead: Lead): boolean {
  return Boolean(lead.lastReplyAt) || stageAtOrAfterReplied(lead.stage);
}

/** Leads/prospects whose `lastReplyAt` falls in the dashboard range (newest first). */
export function listLeadsRepliedInRange(
  leads: readonly Lead[],
  range: DashboardTimeRangeKey,
  opts?: { now?: Date; timeZone?: string },
): Lead[] {
  const start = getDashboardRangeStart(range, {
    now: opts?.now,
    timeZone: opts?.timeZone,
  }).getTime();
  return leads
    .filter((lead) => {
      const repliedAt = validTime(lead.lastReplyAt);
      return repliedAt !== undefined && repliedAt >= start;
    })
    .sort((a, b) => {
      const aTime = validTime(a.lastReplyAt) ?? 0;
      const bTime = validTime(b.lastReplyAt) ?? 0;
      return bTime - aTime;
    });
}

function isBounceReviewTask(task: LeadTask): boolean {
  if (task.source === "email_bounce") return true;
  return task.taskType === "review" && task.title === BOUNCE_REVIEW_TASK_TITLE;
}

export type DashboardWorkflowMetrics = {
  openSalesLeads: number;
  idleSalesLeads: number;
  prospects: number;
  /** Prospects with no channel assignment yet. */
  prospectsNeedRouting: number;
  /** Prospects with a channel assigned but at least one assignment not pushed. */
  prospectsReadyToPush: number;
  prospectsPushed: number;
  /** Prospects with no follow-up sequence built yet (`no_sequence`). */
  prospectsNeedSequence: number;
  followupsDue: number;
  overdueFollowups: number;
  scheduledSteps: number;
  readyUnscheduledSteps: number;
  sentInRange: number;
  failedDeliveries: number;
  /** Transient failures awaiting auto-retry. */
  retryingDeliveries: number;
  /** Hard bounces detected in the selected range (contacts or bounce-review tasks). */
  bouncedEmailsInRange: number;
  /** Open review tasks created from hard bounces (find valid email). */
  openBounceReviewTasks: number;
  /** Leads with a first-party email open (`lastEmailOpenedAt`) in the selected range. */
  opensInRange: number;
  activeSequences: number;
  remainingSequenceSteps: number;
  pausedOnReply: number;
  /** Leads with a detected reply (`lastReplyAt`) or stage at/after `replied`. */
  totalReplies: number;
  /** Leads whose `lastReplyAt` falls in the selected dashboard range. */
  repliesInRange: number;
  repliesPendingReview: number;
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
  return (lead.prospectChannelAssignments ?? []).length === 0;
}

export function prospectReadyToPush(lead: Lead): boolean {
  if (lead.intakeKind !== "prospect") return false;
  const assignments = lead.prospectChannelAssignments ?? [];
  if (assignments.length === 0) return false;
  return assignments.some((assignment) => !assignment.pushedAt);
}

export function computeDashboardWorkflowMetrics(input: {
  leads: readonly Lead[];
  followups: readonly Followup[];
  plans: readonly FollowupPlan[];
  tasks: readonly LeadTask[];
  currentUserId: string;
  range: DashboardTimeRangeKey;
  now?: Date;
  /** Optional contacts for bounce timestamp metrics. */
  contacts?: readonly Contact[];
  /** IANA timezone for due/overdue calendar boundaries (org or browser). */
  timeZone?: string;
}): DashboardWorkflowMetrics {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const start = getDashboardRangeStart(input.range, {
    now,
    timeZone: input.timeZone,
  }).getTime();
  const timeOpts = { now, timeZone: input.timeZone };

  const salesLeads = input.leads.filter(isSalesLead);
  const prospects = input.leads.filter((lead) => lead.intakeKind === "prospect");
  // Queued / remaining sequence work: still open, not paused (may include scheduled).
  const openUnpausedFollowups = input.followups.filter(
    (followup) => !followup.completedAt && !followup.pausedAt,
  );
  const dueFollowups = input.followups.filter((followup) =>
    isFollowupDueThroughToday(followup, timeOpts),
  );
  const activePlanIds = new Set(
    input.plans.filter((plan) => plan.status === "active").map((plan) => plan.id),
  );
  const openTasks = input.tasks.filter((task) => !task.completedAt);
  const bounceReviewTasks = input.tasks.filter(isBounceReviewTask);
  const openBounceReviewTasks = bounceReviewTasks.filter((task) => !task.completedAt).length;

  const bouncedFromContacts =
    input.contacts?.filter((c) => {
      if (c.emailVerificationStatus !== "bounced") return false;
      const at = validTime(c.emailBouncedAt);
      return at !== undefined && at >= start;
    }).length ?? 0;
  const bouncedFromTasks = bounceReviewTasks.filter((task) => {
    const at = validTime(task.createdAt);
    return at !== undefined && at >= start;
  }).length;
  const bouncedEmailsInRange = Math.max(bouncedFromContacts, bouncedFromTasks);

  return {
    openSalesLeads: salesLeads.filter((lead) => !["won", "lost"].includes(lead.stage)).length,
    idleSalesLeads: salesLeads.filter(
      (lead) => lead.isIdle && !["won", "lost"].includes(lead.stage),
    ).length,
    prospects: prospects.length,
    prospectsNeedRouting: prospects.filter(prospectNeedsRouting).length,
    prospectsReadyToPush: prospects.filter(prospectReadyToPush).length,
    prospectsPushed: prospects.filter((lead) => Boolean(lead.linkedSalesLeadId)).length,
    prospectsNeedSequence: prospects.filter(
      (lead) => getLeadSequenceStatus(lead, input.plans, input.followups) === "no_sequence",
    ).length,
    followupsDue: dueFollowups.length,
    overdueFollowups: dueFollowups.filter((followup) =>
      isFollowupOverdue(followup, timeOpts),
    ).length,
    scheduledSteps: openUnpausedFollowups.filter(
      (followup) => followup.deliveryStatus === "scheduled" || Boolean(followup.scheduledEmailId),
    ).length,
    readyUnscheduledSteps: openUnpausedFollowups.filter(
      (followup) =>
        isFollowupActionable(followup) &&
        Boolean(followup.messageBody?.trim()) &&
        !followup.scheduledEmailId,
    ).length,
    sentInRange: input.followups.filter((followup) => {
      const sent = validTime(followup.sentAt);
      return followup.deliveryStatus === "sent" && sent !== undefined && sent >= start;
    }).length,
    failedDeliveries: input.followups.filter(
      (followup) => followup.deliveryStatus === "failed" && !followup.completedAt,
    ).length,
    retryingDeliveries: input.followups.filter(
      (followup) => followup.deliveryStatus === "needs_retry" && !followup.completedAt,
    ).length,
    bouncedEmailsInRange,
    openBounceReviewTasks,
    opensInRange: input.leads.filter((lead) => {
      const openedAt = validTime(lead.lastEmailOpenedAt);
      return openedAt !== undefined && openedAt >= start;
    }).length,
    activeSequences: activePlanIds.size,
    remainingSequenceSteps: openUnpausedFollowups.filter(
      (followup) => Boolean(followup.planId && activePlanIds.has(followup.planId)),
    ).length,
    pausedOnReply: input.plans.filter(
      (plan) => plan.status === "paused" && Boolean(plan.replyMessageId),
    ).length,
    totalReplies: input.leads.filter(leadHasReply).length,
    repliesInRange: input.leads.filter((lead) => {
      const repliedAt = validTime(lead.lastReplyAt);
      return repliedAt !== undefined && repliedAt >= start;
    }).length,
    repliesPendingReview: input.leads.filter(hasPendingReplyReview).length,
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
