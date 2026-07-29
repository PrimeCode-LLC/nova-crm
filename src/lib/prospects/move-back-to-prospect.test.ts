import { describe, expect, it } from "vitest";
import {
  moveBackBlockedReason,
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

  it("blocks when touchpoints exist", () => {
    expect(
      moveBackBlockedReason(baseLead({ prospectOwnerId: "u1", touches: 2 })),
    ).toMatch(/touchpoints/);
  });

  it("blocks when a deal is attached", () => {
    expect(
      moveBackBlockedReason(baseLead({ prospectOwnerId: "u1" }), { hasDeal: true }),
    ).toMatch(/deal/);
  });
});
