import { describe, expect, it } from "vitest";
import {
  isFollowupActionable,
  isFollowupDueThroughToday,
  isFollowupOverdue,
} from "@/lib/followup-open-status";
import {
  computeDashboardWorkflowMetrics,
  prospectNeedsRouting,
  prospectReadyToPush,
} from "@/lib/dashboard-workflow";
import {
  buildActionBoard,
  buildEmailVolumeSeries,
  buildFollowupScheduleByDay,
  buildOpsActivityFeed,
  collectEmailBounceTimes,
  emailVolumeTotals,
} from "@/lib/dashboard-ops-analytics";
import type { Contact, Followup, Lead, LeadTask, TimelineEvent } from "@/lib/types";

function followup(partial: Partial<Followup> & Pick<Followup, "id" | "dueAt">): Followup {
  return {
    title: partial.title ?? "Step",
    ownerId: partial.ownerId ?? "u1",
    priority: partial.priority ?? "medium",
    auto: partial.auto ?? false,
    ...partial,
  };
}

describe("isFollowupActionable", () => {
  it("excludes completed, paused, and terminal delivery states", () => {
    expect(isFollowupActionable(followup({ id: "1", dueAt: "2026-07-01T12:00:00.000Z" }))).toBe(
      true,
    );
    expect(
      isFollowupActionable(
        followup({ id: "2", dueAt: "2026-07-01T12:00:00.000Z", completedAt: "2026-07-02T12:00:00.000Z" }),
      ),
    ).toBe(false);
    expect(
      isFollowupActionable(
        followup({ id: "3", dueAt: "2026-07-01T12:00:00.000Z", pausedAt: "2026-07-02T12:00:00.000Z" }),
      ),
    ).toBe(false);
    expect(
      isFollowupActionable(
        followup({ id: "4", dueAt: "2026-07-01T12:00:00.000Z", deliveryStatus: "sent" }),
      ),
    ).toBe(false);
    expect(
      isFollowupActionable(
        followup({ id: "5", dueAt: "2026-07-01T12:00:00.000Z", deliveryStatus: "failed" }),
      ),
    ).toBe(false);
    expect(
      isFollowupActionable(
        followup({ id: "6", dueAt: "2026-07-01T12:00:00.000Z", deliveryStatus: "needs_retry" }),
      ),
    ).toBe(false);
    expect(
      isFollowupActionable(
        followup({ id: "7", dueAt: "2026-07-01T12:00:00.000Z", deliveryStatus: "scheduled" }),
      ),
    ).toBe(true);
  });
});

describe("isFollowupOverdue calendar boundary", () => {
  // Local noon due date for "yesterday" / "today" relative to a fixed local afternoon.
  it("does not mark today's noon due-date overdue in the afternoon", () => {
    const now = new Date(2026, 6, 29, 15, 0, 0); // Jul 29 3pm local
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const todayNoon = new Date(`${y}-${m}-${d}T12:00:00`);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yy = yesterday.getFullYear();
    const ym = String(yesterday.getMonth() + 1).padStart(2, "0");
    const yd = String(yesterday.getDate()).padStart(2, "0");
    const yesterdayNoon = new Date(`${yy}-${ym}-${yd}T12:00:00`);

    expect(
      isFollowupOverdue(followup({ id: "today", dueAt: todayNoon.toISOString() }), now),
    ).toBe(false);
    expect(
      isFollowupDueThroughToday(followup({ id: "today", dueAt: todayNoon.toISOString() }), now),
    ).toBe(true);
    expect(
      isFollowupOverdue(followup({ id: "yday", dueAt: yesterdayNoon.toISOString() }), now),
    ).toBe(true);
  });
});

describe("computeDashboardWorkflowMetrics overdue", () => {
  it("excludes sent/failed from overdue and uses start-of-day", () => {
    const now = new Date(2026, 6, 29, 15, 0, 0);
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const todayNoon = new Date(`${y}-${m}-${d}T12:00:00`).toISOString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yy = yesterday.getFullYear();
    const ym = String(yesterday.getMonth() + 1).padStart(2, "0");
    const yd = String(yesterday.getDate()).padStart(2, "0");
    const yesterdayNoon = new Date(`${yy}-${ym}-${yd}T12:00:00`).toISOString();

    const metrics = computeDashboardWorkflowMetrics({
      leads: [],
      plans: [],
      tasks: [],
      currentUserId: "u1",
      range: "7d",
      now,
      followups: [
        followup({ id: "overdue", dueAt: yesterdayNoon, ownerId: "u1" }),
        followup({ id: "today", dueAt: todayNoon, ownerId: "u1" }),
        followup({
          id: "sent-no-completed",
          dueAt: yesterdayNoon,
          ownerId: "u1",
          deliveryStatus: "sent",
          sentAt: yesterdayNoon,
        }),
        followup({
          id: "failed",
          dueAt: yesterdayNoon,
          ownerId: "u1",
          deliveryStatus: "failed",
        }),
      ],
    });

    expect(metrics.overdueFollowups).toBe(1);
    expect(metrics.followupsDue).toBe(2); // overdue + today
    expect(metrics.failedDeliveries).toBe(1);
  });

  it("counts opensInRange from lastEmailOpenedAt", () => {
    const now = new Date("2026-07-29T15:00:00.000Z");
    const lead = (partial: Partial<Lead> & Pick<Lead, "id">): Lead =>
      ({
        accountId: "a1",
        contactId: "c1",
        channel: "cold_email",
        stage: "new",
        temperature: "cold",
        priority: "medium",
        ownerId: "u1",
        contactName: "Ada",
        companyName: "Acme",
        touches: 0,
        isIdle: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...partial,
      }) as Lead;

    const metrics = computeDashboardWorkflowMetrics({
      leads: [
        lead({ id: "in-range", lastEmailOpenedAt: "2026-07-28T10:00:00.000Z" }),
        lead({ id: "out-of-range", lastEmailOpenedAt: "2026-06-01T10:00:00.000Z" }),
        lead({ id: "never" }),
      ],
      followups: [],
      plans: [],
      tasks: [],
      currentUserId: "u1",
      range: "7d",
      now,
    });

    expect(metrics.opensInRange).toBe(1);
  });
});

describe("buildOpsActivityFeed email_opened", () => {
  it("includes email_opened timeline events", () => {
    const feed = buildOpsActivityFeed({
      timelineByLead: {
        lead1: [
          {
            id: "te-1",
            type: "email_opened",
            actorId: "u1",
            summary: "Email opened",
            createdAt: "2026-07-28T10:00:00.000Z",
          } as TimelineEvent,
        ],
      },
      limit: 10,
    });
    expect(feed).toHaveLength(1);
    expect(feed[0]?.type).toBe("email_opened");
    expect(feed[0]?.leadId).toBe("lead1");
  });
});

describe("buildEmailVolumeSeries opens", () => {
  it("buckets lastEmailOpenedAt into the opens series", () => {
    const now = new Date("2026-07-29T15:00:00.000Z");
    const lead = (partial: Partial<Lead> & Pick<Lead, "id">): Lead =>
      ({
        accountId: "a1",
        contactId: "c1",
        channel: "cold_email",
        stage: "new",
        temperature: "cold",
        priority: "medium",
        ownerId: "u1",
        contactName: "Ada",
        companyName: "Acme",
        touches: 0,
        isIdle: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...partial,
      }) as Lead;

    const points = buildEmailVolumeSeries({
      followups: [],
      leads: [
        lead({ id: "opened", lastEmailOpenedAt: "2026-07-28T10:00:00.000Z" }),
        lead({ id: "old", lastEmailOpenedAt: "2026-06-01T10:00:00.000Z" }),
        lead({ id: "never" }),
      ],
      period: "week",
      now,
      timeZone: "UTC",
    });

    const totals = emailVolumeTotals(points);
    expect(totals.opens).toBe(1);
    expect(totals.sent).toBe(0);
  });
});

describe("buildFollowupScheduleByDay / buildActionBoard", () => {
  it("keeps today's due items in scheduled, not overdue, after noon", () => {
    const now = new Date(2026, 6, 29, 15, 0, 0);
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const todayNoon = new Date(`${y}-${m}-${d}T12:00:00`).toISOString();
    const points = buildFollowupScheduleByDay({
      now,
      followups: [followup({ id: "today", dueAt: todayNoon })],
    });
    const dayPoint = points.find((p) => p.day === now.getDate());
    expect(dayPoint?.scheduled).toBe(1);
    expect(dayPoint?.overdue).toBe(0);

    const board = buildActionBoard({
      now,
      tasks: [],
      meetings: [],
      followups: [followup({ id: "today", dueAt: todayNoon })],
      limit: null,
    });
    expect(board.overdueFollowups).toHaveLength(0);
  });
});

describe("collectEmailBounceTimes", () => {
  it("does not double-count contacts and bounce-review tasks", () => {
    const contacts: Contact[] = [
      {
        id: "c1",
        name: "A",
        email: "a@x.com",
        ownerId: "u1",
        createdAt: "2026-07-01T00:00:00.000Z",
        emailVerificationStatus: "bounced",
        emailBouncedAt: "2026-07-28T10:00:00.000Z",
      } as unknown as Contact,
    ];
    const tasks: LeadTask[] = [
      {
        id: "t1",
        title: "Find valid email (bounced)",
        taskType: "review",
        visibility: "on_lead",
        assigneeId: "u1",
        createdById: "u1",
        createdAt: "2026-07-28T10:01:00.000Z",
        source: "email_bounce",
      },
    ];

    const times = collectEmailBounceTimes({ contacts, tasks });
    expect(times).toHaveLength(1);
  });

  it("prefers timeline bounce events when present", () => {
    const timelineByLead: Record<string, TimelineEvent[]> = {
      lead1: [
        {
          id: "e1",
          type: "email_bounced",
          summary: "Bounced",
          createdAt: "2026-07-28T10:00:00.000Z",
          actorId: "u1",
        } as TimelineEvent,
      ],
    };
    const contacts: Contact[] = [
      {
        id: "c1",
        name: "A",
        email: "a@x.com",
        ownerId: "u1",
        createdAt: "2026-07-01T00:00:00.000Z",
        emailVerificationStatus: "bounced",
        emailBouncedAt: "2026-07-28T10:00:00.000Z",
      } as unknown as Contact,
    ];
    expect(collectEmailBounceTimes({ contacts, timelineByLead })).toHaveLength(1);
  });
});

describe("prospect routing funnel metrics", () => {
  function prospect(partial: Partial<Lead> = {}): Lead {
    return {
      id: "p1",
      accountId: "a1",
      contactId: "c1",
      channel: "cold_email",
      stage: "new",
      temperature: "cold",
      priority: "medium",
      ownerId: "u1",
      contactName: "Ada",
      companyName: "Acme",
      touches: 0,
      isIdle: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      intakeKind: "prospect",
      ...partial,
    };
  }

  it("splits unassigned vs assigned-unpushed vs pushed", () => {
    const unassigned = prospect({ id: "unassigned" });
    const ready = prospect({
      id: "ready",
      prospectChannelAssignments: [
        { id: "a1", channel: "cold_email", assigneeId: "u2", assignedAt: "2026-01-02T00:00:00.000Z" },
      ],
    });
    const pushed = prospect({
      id: "pushed",
      linkedSalesLeadId: "s1",
      prospectChannelAssignments: [
        {
          id: "a1",
          channel: "cold_email",
          assigneeId: "u2",
          assignedAt: "2026-01-02T00:00:00.000Z",
          pushedAt: "2026-01-03T00:00:00.000Z",
        },
      ],
    });

    expect(prospectNeedsRouting(unassigned)).toBe(true);
    expect(prospectReadyToPush(unassigned)).toBe(false);

    expect(prospectNeedsRouting(ready)).toBe(false);
    expect(prospectReadyToPush(ready)).toBe(true);

    expect(prospectNeedsRouting(pushed)).toBe(false);
    expect(prospectReadyToPush(pushed)).toBe(false);

    const metrics = computeDashboardWorkflowMetrics({
      leads: [unassigned, ready, pushed],
      followups: [],
      plans: [],
      tasks: [],
      currentUserId: "u1",
      range: "7d",
    });
    expect(metrics.prospectsNeedRouting).toBe(1);
    expect(metrics.prospectsReadyToPush).toBe(1);
    expect(metrics.prospectsPushed).toBe(1);
    // No plans/followups → all three prospects still need a sequence.
    expect(metrics.prospectsNeedSequence).toBe(3);
  });
});
