import { getDashboardRangeStart, type DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import { computeUserOpenPipelineMetrics } from "@/lib/dashboard-analytics";
import { isSalesLead } from "@/lib/dashboard-workflow";
import { viewerHasElevatedWorkspaceRole } from "@/lib/viewer-elevated";
import type {
  ActivityRecord,
  Deal,
  Followup,
  Lead,
  LeadTask,
  Meeting,
  OrgActivityEvent,
  OrgActivityEventType,
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

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hourLabel(h: number): string {
  const ampm = h >= 12 ? "p" : "a";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${ampm}`;
}

/** Owner / manager ops board vs frontline personal dashboard. */
export function showOwnerOpsDashboard(viewer: User | undefined): boolean {
  if (!viewer) return false;
  if (viewerHasElevatedWorkspaceRole(viewer)) return true;
  if (viewer.orgRole === "manager") return true;
  return viewer.roleId === "director" || viewer.roleId === "manager" || viewer.roleId === "team_lead";
}

export function buildEmailVolumeSeries(input: {
  followups: readonly Followup[];
  leads: readonly Lead[];
  period: EmailVolumePeriod;
  now?: Date;
}): EmailVolumePoint[] {
  const now = input.now ?? new Date();
  const sent = input.followups.filter((f) => f.deliveryStatus === "sent" && validTime(f.sentAt) !== undefined);
  const replies = input.leads.filter((l) => validTime(l.lastReplyAt) !== undefined);

  if (input.period === "today") {
    const start = startOfLocalDay(now);
    const points: EmailVolumePoint[] = [];
    for (let h = 0; h < 24; h++) {
      const bucketStart = new Date(start);
      bucketStart.setHours(h, 0, 0, 0);
      const bucketEnd = new Date(start);
      bucketEnd.setHours(h + 1, 0, 0, 0);
      const bs = bucketStart.getTime();
      const be = bucketEnd.getTime();
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
      });
    }
    return points;
  }

  const days = input.period === "week" ? 7 : 30;
  const points: EmailVolumePoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const bs = startOfLocalDay(d).getTime();
    const be = startOfLocalDay(next).getTime();
    points.push({
      key,
      label: input.period === "week" ? d.toLocaleDateString(undefined, { weekday: "short" }) : String(d.getDate()),
      sent: sent.filter((f) => {
        const t = validTime(f.sentAt)!;
        return t >= bs && t < be;
      }).length,
      replies: replies.filter((l) => {
        const t = validTime(l.lastReplyAt)!;
        return t >= bs && t < be;
      }).length,
    });
  }
  return points;
}

/** Calendar month schedule: open follow-ups by due day + completed/sent in month. */
export function buildFollowupScheduleByDay(input: {
  followups: readonly Followup[];
  now?: Date;
}): FollowupSchedulePoint[] {
  const now = input.now ?? new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const nowMs = now.getTime();
  const points: FollowupSchedulePoint[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dayStart = new Date(year, month, day, 0, 0, 0, 0).getTime();
    const dayEnd = new Date(year, month, day + 1, 0, 0, 0, 0).getTime();
    let scheduled = 0;
    let overdue = 0;
    let completed = 0;

    for (const f of input.followups) {
      const due = validTime(f.dueAt);
      const sent = validTime(f.sentAt);
      const done = validTime(f.completedAt);

      if (f.deliveryStatus === "sent" && sent !== undefined && sent >= dayStart && sent < dayEnd) {
        completed += 1;
        continue;
      }
      if (done !== undefined && done >= dayStart && done < dayEnd) {
        completed += 1;
        continue;
      }

      if (f.completedAt || f.pausedAt) continue;
      if (due === undefined || due < dayStart || due >= dayEnd) continue;

      if (due < nowMs) overdue += 1;
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
}): OpsScorecardRow[] {
  const now = input.now ?? new Date();
  const start = getDashboardRangeStart(input.range, now).getTime();
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
  limit?: number;
}): InboxPerfRow[] {
  const now = input.now ?? new Date();
  const start = getDashboardRangeStart(input.range, now).getTime();
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
        (f) => f.ownerId === u.id && f.deliveryStatus === "failed" && !f.completedAt,
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
  "followup_created",
  "followup_completed",
  "followup_plan_paused",
  "meeting_scheduled",
  "meeting_completed",
  "prospect_channel_pushed",
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
  "import_completed",
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
      flat.push({
        id: e.id,
        type: e.type,
        actorId: e.actorId,
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
  /**
   * Cap per list bucket. Pass `null` for the expanded detail board (no cap).
   * Compact dashboard widget defaults to 8.
   */
  limit?: number | null;
}): ActionBoardBuckets {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const dayStart = startOfLocalDay(now).getTime();
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
      .filter((f) => {
        if (f.completedAt || f.pausedAt || f.deliveryStatus === "sent") return false;
        const due = validTime(f.dueAt);
        return due !== undefined && due < nowMs;
      })
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

export function emailVolumeTotals(points: readonly EmailVolumePoint[]): { sent: number; replies: number } {
  return points.reduce(
    (acc, p) => ({ sent: acc.sent + p.sent, replies: acc.replies + p.replies }),
    { sent: 0, replies: 0 },
  );
}
