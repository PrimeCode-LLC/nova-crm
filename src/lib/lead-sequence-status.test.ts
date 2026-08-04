import { describe, expect, it } from "vitest";

import { getLeadSequenceStatus } from "@/lib/lead-sequence-status";
import type { Followup, FollowupPlan, Lead } from "@/lib/types";

function lead(partial: Partial<Lead> & Pick<Lead, "id">): Pick<Lead, "id" | "channel"> {
  return { id: partial.id, channel: partial.channel ?? "cold_email" };
}

function plan(partial: Partial<FollowupPlan> & Pick<FollowupPlan, "id" | "leadId" | "status">): FollowupPlan {
  return {
    ownerId: "u1",
    planSummary: "Sequence",
    createdAt: "2026-01-01T00:00:00.000Z",
    kind: "sequence",
    ...partial,
  };
}

function step(
  partial: Partial<Followup> & Pick<Followup, "id" | "planId" | "leadId">,
): Followup {
  return {
    ownerId: "u1",
    dueAt: "2026-01-02T12:00:00.000Z",
    title: "Step",
    messageBody: "Hello",
    channel: "cold_email",
    priority: "medium",
    auto: true,
    ...partial,
  };
}

describe("getLeadSequenceStatus", () => {
  it("returns no_sequence when there is no plan", () => {
    expect(getLeadSequenceStatus(lead({ id: "l1" }), [], [])).toBe("no_sequence");
  });

  it("returns needs_schedule for active plan with ready email steps", () => {
    const plans = [plan({ id: "p1", leadId: "l1", status: "active" })];
    const followups = [step({ id: "f1", planId: "p1", leadId: "l1" })];
    expect(getLeadSequenceStatus(lead({ id: "l1" }), plans, followups)).toBe("needs_schedule");
  });

  it("returns scheduled when email steps are queued", () => {
    const plans = [plan({ id: "p1", leadId: "l1", status: "active" })];
    const followups = [
      step({
        id: "f1",
        planId: "p1",
        leadId: "l1",
        scheduledEmailId: "se1",
        deliveryStatus: "scheduled",
      }),
    ];
    expect(getLeadSequenceStatus(lead({ id: "l1" }), plans, followups)).toBe("scheduled");
  });

  it("returns scheduled for active LinkedIn-only open steps", () => {
    const plans = [plan({ id: "p1", leadId: "l1", status: "active" })];
    const followups = [
      step({
        id: "f1",
        planId: "p1",
        leadId: "l1",
        channel: "linkedin_outbound",
        messageBody: "Connect note",
      }),
    ];
    expect(
      getLeadSequenceStatus(lead({ id: "l1", channel: "linkedin_outbound" }), plans, followups),
    ).toBe("scheduled");
  });

  it("returns needs_attention when a step failed", () => {
    const plans = [plan({ id: "p1", leadId: "l1", status: "active" })];
    const followups = [
      step({
        id: "f1",
        planId: "p1",
        leadId: "l1",
        deliveryStatus: "failed",
        scheduledEmailId: "se1",
      }),
    ];
    expect(getLeadSequenceStatus(lead({ id: "l1" }), plans, followups)).toBe("needs_attention");
  });

  it("returns paused when the current plan is paused", () => {
    const plans = [plan({ id: "p1", leadId: "l1", status: "paused", pausedAt: "2026-01-03T00:00:00.000Z" })];
    expect(getLeadSequenceStatus(lead({ id: "l1" }), plans, [])).toBe("paused");
  });

  it("returns completed for a finished plan with no active/paused", () => {
    const plans = [
      plan({
        id: "p1",
        leadId: "l1",
        status: "completed",
        completedAt: "2026-01-04T00:00:00.000Z",
      }),
    ];
    expect(getLeadSequenceStatus(lead({ id: "l1" }), plans, [])).toBe("completed");
  });

  it("prefers active over completed", () => {
    const plans = [
      plan({ id: "p-old", leadId: "l1", status: "completed", createdAt: "2026-01-01T00:00:00.000Z" }),
      plan({ id: "p-new", leadId: "l1", status: "active", createdAt: "2026-02-01T00:00:00.000Z" }),
    ];
    const followups = [step({ id: "f1", planId: "p-new", leadId: "l1" })];
    expect(getLeadSequenceStatus(lead({ id: "l1" }), plans, followups)).toBe("needs_schedule");
  });
});
