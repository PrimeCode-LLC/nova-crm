import { describe, expect, it } from "vitest";
import {
  buildMoveToLeadPatch,
  canMoveToLead,
  moveToLeadBlockedReason,
  moveToLeadConfirmCopy,
} from "@/lib/prospects/move-to-lead";
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

describe("canMoveToLead", () => {
  it("allows prospects", () => {
    expect(canMoveToLead(baseLead({ intakeKind: "prospect" }))).toBe(true);
  });

  it("rejects sales leads", () => {
    expect(canMoveToLead(baseLead())).toBe(false);
  });
});

describe("moveToLeadBlockedReason", () => {
  it("blocks non-prospects", () => {
    expect(moveToLeadBlockedReason(baseLead())).toMatch(/already a sales lead/);
  });

  it("blocks when a channel-pushed sales lead exists", () => {
    expect(
      moveToLeadBlockedReason(
        baseLead({ intakeKind: "prospect", linkedSalesLeadId: "sl1" }),
      ),
    ).toMatch(/already has a sales lead/);
  });

  it("allows a plain prospect", () => {
    expect(moveToLeadBlockedReason(baseLead({ intakeKind: "prospect" }))).toBeNull();
  });
});

describe("buildMoveToLeadPatch", () => {
  it("clears intake and claims open-queue ownership", () => {
    const patch = buildMoveToLeadPatch({
      lead: { ownerId: "" },
      actorId: "actor-1",
      now: "2026-06-01T00:00:00.000Z",
    });
    expect(patch.intakeKind).toBeUndefined();
    expect(patch.ownerId).toBe("actor-1");
    expect(patch.lastActivityAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("keeps an existing owner", () => {
    const patch = buildMoveToLeadPatch({
      lead: { ownerId: "u1" },
      actorId: "actor-1",
    });
    expect(patch.ownerId).toBeUndefined();
  });
});

describe("moveToLeadConfirmCopy", () => {
  it("returns move-to-lead labels", () => {
    const copy = moveToLeadConfirmCopy();
    expect(copy.confirmLabel).toBe("Move to lead");
    expect(copy.description).toMatch(/sales pipeline/);
  });
});
