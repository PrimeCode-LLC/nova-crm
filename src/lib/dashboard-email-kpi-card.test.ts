import { describe, expect, it } from "vitest";
import {
  buildEmailKpiCardMetrics,
  countSequenceSentBySender,
  followupSenderId,
  resolveEmailKpiSenderIds,
} from "@/lib/dashboard-email-kpi-card";
import type { Followup, Lead, LeadTask, User } from "@/lib/types";

function user(partial: Partial<User> & Pick<User, "id">): User {
  return {
    email: `${partial.id}@ex.com`,
    displayName: partial.id,
    roleId: "salesperson",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as User;
}

function lead(partial: Partial<Lead> & Pick<Lead, "id" | "ownerId">): Lead {
  return {
    accountId: "a1",
    contactId: "c1",
    channel: "cold_email",
    stage: "new",
    temperature: "cold",
    priority: "medium",
    contactName: "Ada",
    companyName: "Acme",
    touches: 0,
    isIdle: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as Lead;
}

function followup(partial: Partial<Followup> & Pick<Followup, "id">): Followup {
  return {
    leadId: "ld-1",
    ownerId: "u1",
    dueAt: "2026-09-01T12:00:00.000Z",
    title: "Step",
    createdAt: "2026-09-01T00:00:00.000Z",
    priority: "medium",
    auto: true,
    ...partial,
  } as Followup;
}

function task(partial: Partial<LeadTask> & Pick<LeadTask, "id">): LeadTask {
  return {
    title: "Find valid email (bounced)",
    taskType: "review",
    visibility: "on_lead",
    assigneeId: "u1",
    createdById: "u1",
    createdAt: "2026-09-10T00:00:00.000Z",
    source: "email_bounce",
    ...partial,
  } as LeadTask;
}

describe("email KPI card helpers", () => {
  it("prefers mailboxOwnerUid as sender", () => {
    expect(
      followupSenderId({
        ownerId: "owner",
        mailboxOwnerUid: "mailbox-user",
      }),
    ).toBe("mailbox-user");
    expect(followupSenderId({ ownerId: "owner" })).toBe("owner");
  });

  it("scopes senders to self for non-admin me filter", () => {
    const viewer = user({ id: "u1", roleId: "salesperson", orgRole: "member" });
    const ids = resolveEmailKpiSenderIds({
      viewer,
      orgUsers: [viewer, user({ id: "u2", managerId: "u1" })],
      ownerScope: "me",
    });
    expect(ids).toEqual(new Set(["u1"]));
  });

  it("admin all-owners sees all senders (null ceiling)", () => {
    const viewer = user({ id: "admin", roleId: "director", orgRole: "admin" });
    const ids = resolveEmailKpiSenderIds({
      viewer,
      orgUsers: [viewer, user({ id: "u2" })],
      ownerScope: "all-owners",
    });
    expect(ids).toBeNull();
  });

  it("counts sequence sent by sender in range and adds compose live slice", () => {
    const viewer = user({ id: "u1", orgRole: "member" });
    const now = new Date("2026-09-15T12:00:00.000Z");
    const metrics = buildEmailKpiCardMetrics({
      viewer,
      orgUsers: [viewer],
      ownerScope: "me",
      range: "7d",
      now,
      leads: [lead({ id: "ld-1", ownerId: "u1" })],
      followups: [
        followup({
          id: "f1",
          ownerId: "u1",
          mailboxOwnerUid: "u1",
          deliveryStatus: "sent",
          sentAt: "2026-09-14T10:00:00.000Z",
        }),
        followup({
          id: "f2",
          ownerId: "u1",
          mailboxOwnerUid: "u2",
          deliveryStatus: "sent",
          sentAt: "2026-09-14T11:00:00.000Z",
        }),
        followup({
          id: "f3",
          ownerId: "u1",
          deliveryStatus: "scheduled",
          scheduledEmailId: "se-1",
        }),
      ],
      tasks: [
        task({
          id: "t1",
          createdById: "u1",
          assigneeId: "u1",
          createdAt: "2026-09-14T00:00:00.000Z",
        }),
      ],
      live: { composeSentInRange: 2, opensInRange: 5 },
    });

    expect(metrics.sentInRange).toBe(3); // 1 sequence by u1 + 2 compose
    expect(metrics.opensInRange).toBe(5);
    expect(metrics.scheduledSteps).toBe(1);
    expect(metrics.bouncedEmailsInRange).toBe(1);
    expect(metrics.openBounceReviewTasks).toBe(1);
  });

  it("does not count teammate sequence sends for me scope", () => {
    expect(
      countSequenceSentBySender({
        senderIds: new Set(["u1"]),
        rangeStart: Date.parse("2026-09-01T00:00:00.000Z"),
        followups: [
          followup({
            id: "f1",
            mailboxOwnerUid: "u2",
            deliveryStatus: "sent",
            sentAt: "2026-09-10T00:00:00.000Z",
          }),
        ],
      }),
    ).toBe(0);
  });

  it("excludes deliveryStatus scheduled from need schedule", () => {
    const viewer = user({ id: "u1", orgRole: "member" });
    const metrics = buildEmailKpiCardMetrics({
      viewer,
      orgUsers: [viewer],
      ownerScope: "me",
      range: "30d",
      now: new Date("2026-09-15T12:00:00.000Z"),
      leads: [lead({ id: "ld-1", ownerId: "u1" })],
      followups: [
        followup({
          id: "f1",
          leadId: "ld-1",
          ownerId: "u1",
          deliveryStatus: "scheduled",
          hasMessageBody: true,
        }),
      ],
      tasks: [],
      live: { composeSentInRange: 0, opensInRange: 0 },
    });
    expect(metrics.scheduledSteps).toBe(1);
    expect(metrics.readyUnscheduledSteps).toBe(0);
  });
});
