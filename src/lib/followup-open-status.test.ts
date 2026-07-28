import { describe, expect, it } from "vitest";
import {
  isFollowupActionable,
  isFollowupDueThroughToday,
  isFollowupOverdue,
} from "@/lib/followup-open-status";
import { computeDashboardWorkflowMetrics } from "@/lib/dashboard-workflow";
import {
  buildActionBoard,
  buildFollowupScheduleByDay,
  collectEmailBounceTimes,
} from "@/lib/dashboard-ops-analytics";
import type { Contact, Followup, LeadTask, TimelineEvent } from "@/lib/types";

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
