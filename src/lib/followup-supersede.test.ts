import { describe, expect, it } from "vitest";
import {
  SUPERSEDED_STEP_CANCEL_REASON,
  isSupersededFollowup,
  retirableFollowupsForPlan,
} from "@/lib/followup-plans";
import type { Followup } from "@/lib/types";

function step(overrides: Partial<Followup> & { id: string }): Followup {
  return {
    leadId: "l1",
    title: "Step",
    planId: "fp-1",
    dueAt: "2026-01-01T12:00:00.000Z",
    ownerId: "u1",
    priority: "medium",
    auto: false,
    ...overrides,
  };
}

describe("retirableFollowupsForPlan", () => {
  it("retires open, paused, and already-cancelled steps of the replaced plan", () => {
    const followups = [
      step({ id: "open" }),
      step({ id: "paused", pausedAt: "2026-01-02T00:00:00.000Z" }),
      step({
        id: "cancelled-on-reply",
        deliveryStatus: "cancelled",
        cancelReason: "Lead replied by email",
      }),
      step({ id: "failed", deliveryStatus: "failed" }),
    ];
    expect(retirableFollowupsForPlan(followups, "fp-1").map((f) => f.id)).toEqual([
      "open",
      "paused",
      "cancelled-on-reply",
      "failed",
    ]);
  });

  it("never retires a step that was actually delivered", () => {
    const followups = [
      step({ id: "sent", deliveryStatus: "sent", sentAt: "2026-01-01T12:05:00.000Z" }),
      step({ id: "completed", completedAt: "2026-01-01T13:00:00.000Z" }),
    ];
    expect(retirableFollowupsForPlan(followups, "fp-1")).toEqual([]);
  });

  it("ignores steps from other plans and is idempotent across replans", () => {
    const followups = [
      step({ id: "other-plan", planId: "fp-2" }),
      step({
        id: "already-retired",
        deliveryStatus: "cancelled",
        cancelReason: SUPERSEDED_STEP_CANCEL_REASON,
      }),
    ];
    expect(retirableFollowupsForPlan(followups, "fp-1")).toEqual([]);
  });
});

describe("isSupersededFollowup", () => {
  it("separates replan casualties from steps cancelled for other reasons", () => {
    expect(isSupersededFollowup({ cancelReason: SUPERSEDED_STEP_CANCEL_REASON })).toBe(true);
    expect(isSupersededFollowup({ cancelReason: "Lead replied by email" })).toBe(false);
    expect(isSupersededFollowup({ cancelReason: undefined })).toBe(false);
  });
});
