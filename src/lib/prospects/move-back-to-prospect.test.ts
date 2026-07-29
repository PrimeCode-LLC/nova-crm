import { describe, expect, it } from "vitest";
import {
  moveBackBlockedReason,
  moveBackConfirmCopy,
  moveBackHasActivity,
  moveBackModeFor,
} from "@/lib/prospects/move-back-to-prospect";
import type { Lead } from "@/lib/types";

function baseLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "l1",
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
    ...overrides,
  };
}

describe("moveBackModeFor", () => {
  it("returns null for current prospects", () => {
    expect(moveBackModeFor(baseLead({ intakeKind: "prospect" }))).toBeNull();
  });

  it("detects channel-pushed sales leads", () => {
    expect(moveBackModeFor(baseLead({ prospectSourceId: "p1" }))).toBe("unpush_sales_lead");
  });

  it("detects in-place promoted former prospects", () => {
    expect(
      moveBackModeFor(baseLead({ prospectOwnerId: "u1", stage: "replied" })),
    ).toBe("demote_inplace");
  });

  it("returns null for ordinary sales leads", () => {
    expect(moveBackModeFor(baseLead())).toBeNull();
  });
});

describe("moveBackBlockedReason", () => {
  it("allows early-stage accidental promotes", () => {
    expect(
      moveBackBlockedReason(baseLead({ prospectOwnerId: "u1", stage: "replied" })),
    ).toBeNull();
  });

  it("blocks late pipeline stages", () => {
    expect(
      moveBackBlockedReason(baseLead({ prospectOwnerId: "u1", stage: "qualified" })),
    ).toMatch(/Qualified/);
  });

  it("allows leads with touches (strong confirm instead)", () => {
    expect(
      moveBackBlockedReason(baseLead({ prospectOwnerId: "u1", touches: 2 })),
    ).toBeNull();
  });

  it("blocks when a deal is attached", () => {
    expect(
      moveBackBlockedReason(baseLead({ prospectOwnerId: "u1" }), { hasDeal: true }),
    ).toMatch(/deal/);
  });
});

describe("moveBackConfirmCopy", () => {
  it("requires acknowledgement when outreach activity exists", () => {
    const copy = moveBackConfirmCopy("demote_inplace", {
      touches: 3,
      openFollowups: 2,
      hasActiveSequence: true,
    });
    expect(copy.requiresAck).toBe(true);
    expect(copy.description).toMatch(/follow-up/);
    expect(copy.confirmLabel).toMatch(/Cancel outreach/);
  });

  it("skips acknowledgement for quiet leads", () => {
    const activity = { touches: 0, openFollowups: 0, hasActiveSequence: false };
    const copy = moveBackConfirmCopy("demote_inplace", activity);
    expect(copy.requiresAck).toBe(false);
    expect(moveBackHasActivity(activity)).toBe(false);
  });
});

describe("moveBackHasActivity", () => {
  it("detects any outreach signal", () => {
    expect(
      moveBackHasActivity({ touches: 0, openFollowups: 0, hasActiveSequence: false }),
    ).toBe(false);
    expect(
      moveBackHasActivity({ touches: 1, openFollowups: 0, hasActiveSequence: false }),
    ).toBe(true);
  });
});
