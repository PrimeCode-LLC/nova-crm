import { getDashboardRangeStart, type DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import { computeUserOpenPipelineMetrics } from "@/lib/dashboard-analytics";
import { isSalesLead } from "@/lib/dashboard-workflow";
import { isFollowupActionable, isFollowupOverdue } from "@/lib/followup-open-status";
import {
  resolveOrgTimezone,
  startOfZonedDay,
  zonedDayKey,
  zonedWallTimeToUtc,
} from "@/lib/org-timezone";
import { canAction, type PermissionSubject } from "@/lib/permissions/can";
import { roleAtLeast } from "@/lib/platform/org-role";
import { viewerHasElevatedWorkspaceRole } from "@/lib/viewer-elevated";
import { BOUNCE_REVIEW_TASK_TITLE } from "@/lib/email/detect-hard-bounce";
import type {
  ActivityRecord,
  Contact,
  Deal,
  Followup,
  Lead,
  LeadTask,
  Meeting,
  OrgActivityEvent,
  OrgActivityEventType,
  OrgMemberRole,
  TimelineEvent,
  TimelineEventType,
  User,
} from "@/lib/types";

export type EmailVolumePeriod = "today" | "week" | "month";

export type EmailVolumePoint = {
  label: string;
  key: string;
  sent: number;
  replies: number;
  bounces: number;
};

export type FollowupSchedulePoint = {
  day: number;
  label: string;
  scheduled: number;
  overdue: number;
  completed: number;
};

export type OpsScorecardRow = {
  userId: string;
  prospectsAdded: number;
  salesLeadsAdded: number;
  emailsSent: number;
  replies: number;
  followupsCompleted: number;
  tasksCompleted: number;
  openPipeline: number;
  closedValue: number;
};

export type InboxPerfRow = {
  userId: string;
  emailsSent: number;
  replies: number;
  replyRate: number;
  scheduled: number;
  failed: number;
};

export type OpsFeedItem = {
  id: string;
  type: TimelineEventType | OrgActivityEventType | "task_open" | "followup_due" | "import_completed";
  actorId?: string;
  summary: string;
  createdAt: string;
  leadId?: string;
  href?: string;
};

export type ActionBoardBuckets = {
  urgentTasks: LeadTask[];
  pendingTasks: LeadTask[];
  overdueFollowups: Followup[];
  todayMeetings: Meeting[];
  upcomingMeetings: Meeting[];
};

function validTime(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : undefined;
}

function dayKey(d: Date, timeZone?: string): string {
  return zonedDayKey(d, resolveOrgTimezone(timeZone));
}

function hourLabel(h: number): string {
  const ampm = h >= 12 ? "p" : "a";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${ampm}`;
}

function isBounceReviewTask(task: LeadTask): boolean {
  if (task.source === "email_bounce") return true;
  return task.taskType === "review" && task.title === BOUNCE_REVIEW_TASK_TITLE;
}

function countInWindow(times: readonly number[], startMs: number, endMs: number): number {
  return times.filter((t) => t >= startMs && t < endMs).length;
}

/** Bounce event timestamps for the email-volume series (timeline → contacts → tasks). */
export function collectEmailBounceTimes(input: {
  contacts?: readonly Contact[];
  tasks?: readonly LeadTask[];
  timelineByLead?: Record<string, readonly TimelineEvent[]>;
}): number[] {
  const fromTimeline: number[] = [];
  if (input.timelineByLead) {
    for (const events of Object.values(input.timelineByLead)) {
      for (const event of events) {
        if (event.type !== "email_bounced") continue;
        const t = validTime(event.createdAt);
        if (t !== undefined) fromTimeline.push(t);
      }
    }
  }
  if (fromTimeline.length > 0) return fromTimeline;

  // Prefer a single source so contact + bounce-review task pairs do not double-count
  // (matches KPI Math.max(contacts, tasks) semantics).
  const fromContacts: number[] = [];
  for (const contact of input.contacts ?? []) {
    if (contact.emailVerificationStatus !== "bounced") continue;
    const t = validTime(contact.emailBouncedAt);
    if (t !== undefined) fromContacts.push(t);
  }
  const fromTasks: number[] = [];
  for (const task of input.tasks ?? []) {
    if (!isBounceReviewTask(task)) continue;
    const t = validTime(task.createdAt);
    if (t !== undefined) fromTasks.push(t);
  }
  return fromContacts.length >= fromTasks.length ? fromContacts : fromTasks;
}

/** Owner / manager ops board vs frontline personal dashboard. */
export function showOwnerOpsDashboard(
  viewer: User | undefined,
  /** Live org membership role - used when the CRM user doc is incomplete. */
  orgRole?: OrgMemberRole | null,
  /** Optional permission subject - custom roles with `dashboard.view_team_ops` qualify. */
  permissionSubject?: PermissionSubject,
): boolean {
  if (permissionSubject && canAction(permissionSubject, "dashboard.view_team_ops")) {
    return true;
  }
  if (viewer) {
    if (viewerHasElevatedWorkspaceRole(viewer)) return true;
    if (viewer.orgRole === "manager") return true;
    if (
      viewer.roleId === "director" ||
      viewer.roleId === "manager" ||
      viewer.roleId === "team_lead"
    ) {
      return true;
    }
  }
  // Live tenants: org owner/admin/manager should always reach wall + ops board
  // even if the CRM `users` row is missing or lacks roleId.
  if (orgRole && roleAtLeast(orgRole, "manager")) return true;
  return false;
}

export function buildEmailVolumeSeries(input: {
  followups: readonly Followup[];
  leads: readonly Lead[];
  period: EmailVolumePeriod;
  now?: Date;
  contacts?: readonly Contact[];
  tasks?: readonly LeadTask[];
  timelineByLead?: Record<string, readonly TimelineEvent[]>;
  timeZone?: string;
}): EmailVolumePoint[] {
  const now = input.now ?? new Date();
  const zone = resolveOrgTimezone(input.timeZone);
  const sent = input.followups.filter((f) => f.deliveryStatus === "sent" && validTime(f.sentAt) !== undefined);
  const replies = input.leads.filter((l) => validTime(l.lastReplyAt) !== undefined);
  const bounceTimes = collectEmailBounceTimes({
    contacts: input.contacts,
    tasks: input.tasks,
    timelineByLead: input.timelineByLead,
  });

  if (input.period === "today") {
    const todayKey = zonedDayKey(now, zone);
    const points: EmailVolumePoint[] = [];
    for (let h = 0; h < 24; h++) {
      const bs = zonedWallTimeToUtc(todayKey, h, 0, 0, 0, zone).getTime();
      const be =
        h === 23
          ? zonedWallTimeToUtc(todayKey, 23, 59, 59, 999, zone).getTime() + 1
          : zonedWallTimeToUtc(todayKey, h + 1, 0, 0, 0, zone).getTime();
      points.push({
        key: `${h}`,
        label: hourLabel(h),
        sent: sent.filter((f) => {
          const t = validTime(f.sentAt)!;
          return t >= bs && t < be;
        }).length,
        replies: replies.filter((l) => {
          const t = validTime(l.lastReplyAt)!;
          return t >= bs && t < be;
        }).length,
        bounces: countInWindow(bounceTimes, bs, be),
      });
    }
    return points;
  }

  const days = input.period === "week" ? 7 : 30;
  const points: EmailVolumePoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const anchor = new Date(now.getTime() - i * 86_400_000);
    const key = dayKey(anchor, zone);
    const nextAnchor = new Date(anchor.getTime() + 86_400_000);
    const nextKey = dayKey(nextAnchor, zone);
    const bs = startOfZonedDay(anchor, zone).getTime();
    const be = startOfZonedDay(nextAnchor, zone).getTime();
    // Prefer label from the zoned calendar day (handles DST edge cases better than local).
    const labelDate = zonedWallTimeToUtc(key, 12, 0, 0, 0, zone);
    points.push({
      key,
      label:
        input.period === "week"
          ? labelDate.toLocaleDateString("en-US", { weekday: "short", timeZone: zone })
          : String(Number(key.slice(8, 10))),
      sent: sent.filter((f) => {
        const t = validTime(f.sentAt)!;
        return t >= bs && t < be;
      }).length,
      replies: replies.filter((l) => {
        const t = validTime(l.lastReplyAt)!;
        return t >= bs && t < be;
      }).length,
      bounces: countInWindow(bounceTimes, bs, be),
    });
    void nextKey;
  }
  return points;
}

/** Calendar month schedule: open follow-ups by due day + completed/sent in month. */
export function buildFollowupScheduleByDay(input: {
  followups: readonly Followup[];
  now?: Date;
  timeZone?: string;
}): FollowupSchedulePoint[] {
  const now = input.now ?? new Date();
  const zone = resolveOrgTimezone(input.timeZone);
  const parts = zonedDayKey(now, zone).split("-").map(Number);
  const year = parts[0]!;
  const month = parts[1]!; // 1-12
  const daysInMonth = new Date(year, month, 0).getDate();
  const dayStartToday = startOfZonedDay(now, zone).getTime();
  const points: FollowupSchedulePoint[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const ymd = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayStart = zonedWallTimeToUtc(ymd, 0, 0, 0, 0, zone).getTime();
    const nextDay = day === daysInMonth
      ? zonedWallTimeToUtc(
          `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}-01`,
          0,
          0,
          0,
          0,
          zone,
        ).getTime()
      : zonedWallTimeToUtc(
          `${year}-${String(month).padStart(2, "0")}-${String(day + 1).padStart(2, "0")}`,
          0,
          0,
          0,
          0,
          zone,
        ).getTime();
    let scheduled = 0;
    let overdue = 0;
    let completed = 0;

    for (const f of input.followups) {
      const due = validTime(f.dueAt);
      const sent = validTime(f.sentAt);
      const done = validTime(f.completedAt);

      if (f.deliveryStatus === "sent" && sent !== undefined && sent >= dayStart && sent < nextDay) {
        completed += 1;
        continue;
      }
      if (done !== undefined && done >= dayStart && done < nextDay) {
        completed += 1;
        continue;
      }

      if (!isFollowupActionable(f)) continue;
      if (due === undefined || due < dayStart || due >= nextDay) continue;

      // Calendar overdue (before zoned start of today) — matches Follow-ups page + KPI.
      if (due < dayStartToday) overdue += 1;
      else scheduled += 1;
    }

    points.push({
      day,
      label: String(day),
      scheduled,
      overdue,
      completed,
    });
  }

  return points;
}

export function buildOpsScorecardRows(input: {
  users: readonly User[];
  leads: readonly Lead[];
  deals: readonly Deal[];
  followups: readonly Followup[];
  tasks: readonly LeadTask[];
  range: DashboardTimeRangeKey;
  now?: Date;
  timeZone?: string;
}): OpsScorecardRow[] {
  const now = input.now ?? new Date();
  const start = getDashboardRangeStart(input.range, {
    now,
    timeZone: input.timeZone,
  }).getTime();
  const activeUsers = input.users.filter((u) => u.status === "active" && u.roleId !== "director");

  return activeUsers
    .map((u) => {
      const prospectsAdded = input.leads.filter(
        (l) =>
          l.intakeKind === "prospect" &&
          (l.createdById === u.id || l.scraperId === u.id || l.prospectOwnerId === u.id) &&
          (validTime(l.createdAt) ?? 0) >= start,
      ).length;
      const salesLeadsAdded = input.leads.filter(
        (l) =>
          isSalesLead(l) &&
          l.ownerId === u.id &&
          !["won", "lost"].includes(l.stage) &&
          (validTime(l.createdAt) ?? 0) >= start,
      ).length;
      const emailsSent = input.followups.filter(
        (f) =>
          f.ownerId === u.id &&
          f.deliveryStatus === "sent" &&
          (validTime(f.sentAt) ?? 0) >= start,
      ).length;
      const ownedLeads = input.leads.filter((l) => l.ownerId === u.id);
      const replies = ownedLeads.filter((l) => (validTime(l.lastReplyAt) ?? 0) >= start).length;
      const followupsCompleted = input.followups.filter(
        (f) =>
          f.ownerId === u.id &&
          ((f.deliveryStatus === "sent" && (validTime(f.sentAt) ?? 0) >= start) ||
            (validTime(f.completedAt) ?? 0) >= start),
      ).length;
      const tasksCompleted = input.tasks.filter(
        (t) => t.assigneeId === u.id && (validTime(t.completedAt) ?? 0) >= start,
      ).length;
      const openPipeline = computeUserOpenPipelineMetrics(
        u.id,
        input.leads as Lead[],
        input.deals as Deal[],
      ).total;
      const closedValue = input.deals
        .filter(
          (d) =>
            d.ownerId === u.id &&
            d.stage === "won" &&
            (validTime(d.updatedAt) ?? validTime(d.createdAt) ?? 0) >= start,
        )
        .reduce((s, d) => s + d.value, 0);

      return {
        userId: u.id,
        prospectsAdded,
        salesLeadsAdded,
        emailsSent,
        replies,
        followupsCompleted,
        tasksCompleted,
        openPipeline,
        closedValue,
      };
    })
    .filter(
      (r) =>
        r.prospectsAdded +
          r.salesLeadsAdded +
          r.emailsSent +
          r.replies +
          r.followupsCompleted +
          r.tasksCompleted >
          0 ||
        r.openPipeline > 0 ||
        r.closedValue > 0,
    )
    .sort((a, b) => b.emailsSent + b.replies * 2 - (a.emailsSent + a.replies * 2));
}

/** Top performers by outbound volume + replies (owner proxy for inbox performance). */
export function buildInboxPerformanceRows(input: {
  users: readonly User[];
  leads: readonly Lead[];
  followups: readonly Followup[];
  range: DashboardTimeRangeKey;
  now?: Date;
  timeZone?: string;
  limit?: number;
}): InboxPerfRow[] {
  const now = input.now ?? new Date();
  const start = getDashboardRangeStart(input.range, {
    now,
    timeZone: input.timeZone,
  }).getTime();
  const limit = input.limit ?? 8;

  return input.users
    .filter((u) => u.status === "active" && u.roleId !== "director")
    .map((u) => {
      const emailsSent = input.followups.filter(
        (f) =>
          f.ownerId === u.id &&
          f.deliveryStatus === "sent" &&
          (validTime(f.sentAt) ?? 0) >= start,
      ).length;
      const replies = input.leads.filter(
        (l) => l.ownerId === u.id && (validTime(l.lastReplyAt) ?? 0) >= start,
      ).length;
      const scheduled = input.followups.filter(
        (f) =>
          f.ownerId === u.id &&
          !f.completedAt &&
          !f.pausedAt &&
          (f.deliveryStatus === "scheduled" || Boolean(f.scheduledEmailId)),
      ).length;
      const failed = input.followups.filter(
        (f) =>
          f.ownerId === u.id &&
          (f.deliveryStatus === "failed" || f.deliveryStatus === "needs_retry") &&
          !f.completedAt,
      ).length;
      return {
        userId: u.id,
        emailsSent,
        replies,
        replyRate: emailsSent > 0 ? (replies / emailsSent) * 100 : 0,
        scheduled,
        failed,
      };
    })
    .filter((r) => r.emailsSent + r.replies + r.scheduled + r.failed > 0)
    .sort((a, b) => b.emailsSent - a.emailsSent || b.replies - a.replies)
    .slice(0, limit);
}

const FEED_TYPES = new Set<TimelineEventType>([
  "lead_created",
  "email_sent",
  "email_replied",
  "email_auto_replied",
  "followup_created",
  "followup_completed",
  "followup_plan_paused",
  "meeting_scheduled",
  "meeting_completed",
  "prospect_channel_pushed",
  "lead_moved_to_lead",
  "lead_moved_back_to_prospect",
  "lead_task_created",
  "lead_task_completed",
  "note_added",
  "assignment_changed",
  "deal_created",
  "stage_changed",
  "ai_analysis",
]);

const ORG_FEED_TYPES = new Set<OrgActivityEventType>([
  "strategy_created",
  "strategy_updated",
  "strategy_deleted",
  "strategy_assigned",
  "strategy_assignment_updated",
  "strategy_assignment_paused",
  "strategy_assignment_activated",
  "strategy_assignment_removed",
  "strategy_pack_imported",
  "intake_promoted",
  "intake_dismissed",
  "intake_deleted",
  "intake_pool_emptied",
  "scraper_run",
  "import_completed",
  "wall_exit_denied",
  "wall_exit_attempt",
  "wall_exited",
]);

export function buildOpsActivityFeed(input: {
  timelineByLead: Record<string, TimelineEvent[]>;
  orgActivityEvents?: readonly OrgActivityEvent[];
  activityRecords?: readonly ActivityRecord[];
  limit?: number;
}): OpsFeedItem[] {
  const limit = input.limit ?? 40;
  const flat: OpsFeedItem[] = [];
  for (const [leadId, events] of Object.entries(input.timelineByLead)) {
    for (const e of events) {
      if (!FEED_TYPES.has(e.type)) continue;
      const legacyScheduledActor =
        e.type === "email_sent" &&
        e.payload?.source === "scheduled" &&
        typeof e.payload?.scheduledByUserId !== "string"
          ? e.leadOwnerId
          : undefined;
      flat.push({
        id: e.id,
        type: e.type,
        actorId: legacyScheduledActor || e.actorId,
        summary: e.summary,
        createdAt: e.createdAt,
        leadId,
      });
    }
  }
  for (const e of input.orgActivityEvents ?? []) {
    if (!ORG_FEED_TYPES.has(e.type)) continue;
    flat.push({
      id: e.id,
      type: e.type,
      actorId: e.actorId,
      summary: e.summary,
      createdAt: e.createdAt,
      href: e.href,
      leadId: typeof e.payload?.leadId === "string" ? e.payload.leadId : undefined,
    });
  }
  for (const r of input.activityRecords ?? []) {
    if (r.type !== "import_completed") continue;
    flat.push({
      id: r.id,
      type: "import_completed",
      actorId: r.userId,
      summary: r.summary?.trim() || "Prospect import completed",
      createdAt: r.occurredAt,
      href: "/admin/import",
      leadId: r.leadId,
    });
  }
  flat.sort((a, b) => (validTime(b.createdAt) ?? 0) - (validTime(a.createdAt) ?? 0));
  return flat.slice(0, limit);
}

export function buildActionBoard(input: {
  tasks: readonly LeadTask[];
  followups: readonly Followup[];
  meetings: readonly Meeting[];
  now?: Date;
  timeZone?: string;
  /**
   * Cap per list bucket. Pass `null` for the expanded detail board (no cap).
   * Compact dashboard widget defaults to 8.
   */
  limit?: number | null;
}): ActionBoardBuckets {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const zone = resolveOrgTimezone(input.timeZone);
  const dayStart = startOfZonedDay(now, zone).getTime();
  const dayEnd = dayStart + 86_400_000;
  const cap = input.limit === null ? undefined : (input.limit ?? 8);
  const take = <T,>(items: T[]) => (cap === undefined ? items : items.slice(0, cap));

  const openTasks = input.tasks.filter((t) => !t.completedAt);
  const allUrgent = openTasks
    .filter((t) => {
      const due = validTime(t.dueAt);
      return due !== undefined && due < nowMs;
    })
    .sort((a, b) => (validTime(a.dueAt) ?? 0) - (validTime(b.dueAt) ?? 0));
  const urgentTasks = take(allUrgent);

  // Exclude every overdue task from pending (not only the capped urgent slice).
  const urgentIds = new Set(allUrgent.map((t) => t.id));
  const pendingTasks = take(
    openTasks
      .filter((t) => !urgentIds.has(t.id))
      .sort(
        (a, b) =>
          (validTime(a.dueAt) ?? Number.POSITIVE_INFINITY) -
          (validTime(b.dueAt) ?? Number.POSITIVE_INFINITY),
      ),
  );

  const overdueFollowups = take(
    input.followups
      .filter((f) => isFollowupOverdue(f, { now, timeZone: zone }))
      .sort((a, b) => (validTime(a.dueAt) ?? 0) - (validTime(b.dueAt) ?? 0)),
  );

  const liveMeetings = input.meetings.filter((m) => m.status === "scheduled");
  const todayMeetings = liveMeetings
    .filter((m) => {
      const s = validTime(m.startAt);
      return s !== undefined && s >= dayStart && s < dayEnd;
    })
    .sort((a, b) => (validTime(a.startAt) ?? 0) - (validTime(b.startAt) ?? 0));

  const upcomingMeetings = take(
    liveMeetings
      .filter((m) => {
        const s = validTime(m.startAt);
        return s !== undefined && s >= dayEnd;
      })
      .sort((a, b) => (validTime(a.startAt) ?? 0) - (validTime(b.startAt) ?? 0)),
  );

  return { urgentTasks, pendingTasks, overdueFollowups, todayMeetings, upcomingMeetings };
}

export function emailVolumeTotals(points: readonly EmailVolumePoint[]): {
  sent: number;
  replies: number;
  bounces: number;
} {
  return points.reduce(
    (acc, p) => ({
      sent: acc.sent + p.sent,
      replies: acc.replies + p.replies,
      bounces: acc.bounces + p.bounces,
    }),
    { sent: 0, replies: 0, bounces: 0 },
  );
}
