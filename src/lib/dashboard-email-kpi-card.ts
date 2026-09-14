/**
 * Emails KPI card only — sender vs lead-ownership rules, separate from other pulse tiles.
 *
 * Spec (live):
 * - Sent / opened / bounced → by sender (mailbox owner / compose actor), date-ranged
 * - Queued / need schedule → by lead ownership, current backlog (ignore date)
 * - Failed → by sender, current backlog (ignore date)
 * - To review → bounce-review tasks assigned to scoped users, current (ignore date)
 * - Opens may exceed sent (opens of older sends in the selected window are allowed)
 */

import { getDashboardRangeStart, type DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import { BOUNCE_REVIEW_TASK_TITLE } from "@/lib/email/detect-hard-bounce";
import { isFollowupActionable } from "@/lib/followup-open-status";
import { OWNER_SCOPE_PREFIX } from "@/lib/owner-scope";
import type { Followup, Lead, LeadTask, User } from "@/lib/types";
import {
  activityActorUserIdsVisibleToViewer,
  leadOwnerIdsVisibleToViewer,
} from "@/lib/workspace-hierarchy";

export type EmailKpiCardMetrics = {
  sentInRange: number;
  opensInRange: number;
  bouncedEmailsInRange: number;
  scheduledSteps: number;
  readyUnscheduledSteps: number;
  failedDeliveries: number;
  retryingDeliveries: number;
  openBounceReviewTasks: number;
};

export type EmailKpiLiveSlice = {
  /** Compose / reply SMTP sends in range (from durable emailSendEvents). */
  composeSentInRange: number;
  /** Distinct tracked messages opened in range, attributed to mailbox owner. */
  opensInRange: number;
};

function validTime(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : undefined;
}

/** Who “sent” a sequence step: mailbox owner when known, else followup owner. */
export function followupSenderId(
  followup: Pick<Followup, "mailboxOwnerUid" | "ownerId">,
): string {
  const mailboxOwner = followup.mailboxOwnerUid?.trim();
  if (mailboxOwner) return mailboxOwner;
  return followup.ownerId?.trim() || "";
}

export function isBounceReviewTask(task: Pick<LeadTask, "source" | "taskType" | "title">): boolean {
  if (task.source === "email_bounce") return true;
  return task.taskType === "review" && task.title === BOUNCE_REVIEW_TASK_TITLE;
}

/**
 * Sender IDs visible for Emails card sent/opened/bounced/failed.
 * `null` = entire org (admin / director / owner).
 */
export function resolveEmailKpiSenderIds(input: {
  viewer: User;
  orgUsers: readonly User[];
  ownerScope: string;
}): Set<string> | null {
  const ceiling = activityActorUserIdsVisibleToViewer(input.viewer, input.orgUsers);
  const scope = input.ownerScope;

  const narrow = (ids: Set<string> | null): Set<string> | null => {
    if (ids === null) return null;
    if (ceiling === null) return ids;
    const out = new Set<string>();
    for (const id of ids) {
      if (ceiling.has(id)) out.add(id);
    }
    return out;
  };

  if (scope === "all-owners" || scope === "open-queue" || scope === "unassigned") {
    return ceiling;
  }
  if (scope === "me") {
    return narrow(new Set([input.viewer.id]));
  }
  if (scope === "team") {
    if (ceiling === null) {
      // Admin viewing "team": peers excluding self matches owner-scope helper.
      return new Set(input.orgUsers.filter((u) => u.id !== input.viewer.id).map((u) => u.id));
    }
    const out = new Set(ceiling);
    out.delete(input.viewer.id);
    return out;
  }
  if (scope.startsWith(OWNER_SCOPE_PREFIX)) {
    const uid = scope.slice(OWNER_SCOPE_PREFIX.length).trim();
    if (!uid) return new Set();
    return narrow(new Set([uid]));
  }
  return ceiling;
}

/**
 * Lead-owner IDs for queued / need-schedule (lead ownership).
 * `null` = entire org.
 */
export function resolveEmailKpiLeadOwnerIds(input: {
  viewer: User;
  orgUsers: readonly User[];
  ownerScope: string;
}): Set<string> | null {
  const ceiling = (() => {
    if (
      input.viewer.roleId === "director" ||
      input.viewer.isSuperAdmin ||
      input.viewer.orgRole === "owner" ||
      input.viewer.orgRole === "admin"
    ) {
      return null;
    }
    return leadOwnerIdsVisibleToViewer(input.viewer, input.orgUsers);
  })();

  const scope = input.ownerScope;
  const narrow = (ids: Set<string>): Set<string> => {
    if (ceiling === null) return ids;
    const out = new Set<string>();
    for (const id of ids) {
      if (ceiling.has(id)) out.add(id);
    }
    return out;
  };

  if (scope === "all-owners" || scope === "open-queue" || scope === "unassigned") {
    return ceiling;
  }
  if (scope === "me") {
    return narrow(new Set([input.viewer.id]));
  }
  if (scope === "team") {
    if (ceiling === null) {
      return new Set(input.orgUsers.filter((u) => u.id !== input.viewer.id).map((u) => u.id));
    }
    const out = new Set(ceiling);
    out.delete(input.viewer.id);
    return out;
  }
  if (scope.startsWith(OWNER_SCOPE_PREFIX)) {
    const uid = scope.slice(OWNER_SCOPE_PREFIX.length).trim();
    if (!uid) return new Set();
    return narrow(new Set([uid]));
  }
  return ceiling;
}

function senderAllowed(senderId: string, allowed: Set<string> | null): boolean {
  if (!senderId) return false;
  if (allowed === null) return true;
  return allowed.has(senderId);
}

function leadOwnerAllowed(ownerId: string | undefined, allowed: Set<string> | null): boolean {
  if (allowed === null) return true;
  const id = ownerId?.trim() ?? "";
  if (!id) return false;
  return allowed.has(id);
}

/** Sequence / scheduled deliveries attributed to the sender, in range. */
export function countSequenceSentBySender(input: {
  followups: readonly Followup[];
  senderIds: Set<string> | null;
  rangeStart: number;
}): number {
  let sent = 0;
  for (const followup of input.followups) {
    if (followup.deliveryStatus !== "sent") continue;
    const sentAt = validTime(followup.sentAt);
    if (sentAt === undefined || sentAt < input.rangeStart) continue;
    if (!senderAllowed(followupSenderId(followup), input.senderIds)) continue;
    sent += 1;
  }
  return sent;
}

export function countBouncedBySender(input: {
  tasks: readonly LeadTask[];
  senderIds: Set<string> | null;
  rangeStart: number;
}): number {
  let n = 0;
  for (const task of input.tasks) {
    if (!isBounceReviewTask(task)) continue;
    const at = validTime(task.createdAt);
    if (at === undefined || at < input.rangeStart) continue;
    // Bounce pipeline stamps createdById as the mailbox / actor uid.
    if (!senderAllowed(task.createdById?.trim() || "", input.senderIds)) continue;
    n += 1;
  }
  return n;
}

export function computeEmailKpiCardBacklog(input: {
  leads: readonly Lead[];
  followups: readonly Followup[];
  tasks: readonly LeadTask[];
  leadOwnerIds: Set<string> | null;
  senderIds: Set<string> | null;
  /** Bounce “to review” assignees — usually same as sender scope, or forced to viewer only. */
  reviewAssigneeIds: Set<string> | null;
}): Pick<
  EmailKpiCardMetrics,
  | "scheduledSteps"
  | "readyUnscheduledSteps"
  | "failedDeliveries"
  | "retryingDeliveries"
  | "openBounceReviewTasks"
> {
  const leadById = new Map(input.leads.map((l) => [l.id, l]));
  const leadOwnedFollowups = input.followups.filter((followup) => {
    if (!followup.leadId) {
      // Standalone reminder: treat followup owner as lead-owner proxy.
      return leadOwnerAllowed(followup.ownerId, input.leadOwnerIds);
    }
    const lead = leadById.get(followup.leadId);
    if (!lead) return false;
    return leadOwnerAllowed(lead.ownerId, input.leadOwnerIds);
  });

  const openUnpaused = leadOwnedFollowups.filter((f) => !f.completedAt && !f.pausedAt);

  const scheduledSteps = openUnpaused.filter(
    (f) => f.deliveryStatus === "scheduled" || Boolean(f.scheduledEmailId),
  ).length;

  const readyUnscheduledSteps = openUnpaused.filter(
    (f) =>
      isFollowupActionable(f) &&
      (Boolean(f.messageBody?.trim()) || Boolean(f.hasMessageBody)) &&
      !f.scheduledEmailId &&
      f.deliveryStatus !== "scheduled",
  ).length;

  const failedDeliveries = input.followups.filter((f) => {
    if (f.deliveryStatus !== "failed" || f.completedAt) return false;
    return senderAllowed(followupSenderId(f), input.senderIds);
  }).length;

  const retryingDeliveries = input.followups.filter((f) => {
    if (f.deliveryStatus !== "needs_retry" || f.completedAt) return false;
    return senderAllowed(followupSenderId(f), input.senderIds);
  }).length;

  const openBounceReviewTasks = input.tasks.filter((task) => {
    if (task.completedAt || !isBounceReviewTask(task)) return false;
    if (input.reviewAssigneeIds === null) return true;
    return input.reviewAssigneeIds.has(task.assigneeId?.trim() || "");
  }).length;

  return {
    scheduledSteps,
    readyUnscheduledSteps,
    failedDeliveries,
    retryingDeliveries,
    openBounceReviewTasks,
  };
}

/**
 * Build Emails card metrics for the pulse strip.
 * Pass `live` from `/api/org/email-kpi-card` in live mode; omit in demo (opens fall back to 0
 * unless `fallbackOpensInRange` is provided).
 */
export function buildEmailKpiCardMetrics(input: {
  leads: readonly Lead[];
  followups: readonly Followup[];
  tasks: readonly LeadTask[];
  viewer: User;
  orgUsers: readonly User[];
  ownerScope: string;
  range: DashboardTimeRangeKey;
  timeZone?: string;
  now?: Date;
  live?: EmailKpiLiveSlice | null;
  /**
   * Demo / offline fallback for opens when durable tracking is unavailable.
   * Live mode should pass `live.opensInRange` instead.
   */
  fallbackOpensInRange?: number;
}): EmailKpiCardMetrics {
  const now = input.now ?? new Date();
  const rangeStart = getDashboardRangeStart(input.range, {
    now,
    timeZone: input.timeZone,
  }).getTime();

  const senderIds = resolveEmailKpiSenderIds({
    viewer: input.viewer,
    orgUsers: input.orgUsers,
    ownerScope: input.ownerScope,
  });
  const leadOwnerIds = resolveEmailKpiLeadOwnerIds({
    viewer: input.viewer,
    orgUsers: input.orgUsers,
    ownerScope: input.ownerScope,
  });

  // “To review: assigned to me” — when owner filter is all/team, expand to scoped assignees
  // so managers/admins still see team/org bounce work; “me” stays self-only.
  const reviewAssigneeIds =
    input.ownerScope === "me" ? new Set([input.viewer.id]) : senderIds;

  const backlog = computeEmailKpiCardBacklog({
    leads: input.leads,
    followups: input.followups,
    tasks: input.tasks,
    leadOwnerIds,
    senderIds,
    reviewAssigneeIds,
  });

  const sequenceSent = countSequenceSentBySender({
    followups: input.followups,
    senderIds,
    rangeStart,
  });
  const composeSent = input.live?.composeSentInRange ?? 0;
  const opensInRange =
    input.live?.opensInRange ??
    (typeof input.fallbackOpensInRange === "number" ? Math.max(0, input.fallbackOpensInRange) : 0);
  const bouncedEmailsInRange = countBouncedBySender({
    tasks: input.tasks,
    senderIds,
    rangeStart,
  });

  return {
    sentInRange: sequenceSent + composeSent,
    opensInRange,
    bouncedEmailsInRange,
    ...backlog,
  };
}
