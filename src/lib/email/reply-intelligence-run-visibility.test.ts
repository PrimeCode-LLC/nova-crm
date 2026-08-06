import { describe, expect, it } from "vitest";
import {
  shouldHighlightMissingReplyNextStep,
  shouldOfferReplyIntelligenceRun,
} from "@/lib/email/reply-intelligence-run-visibility";
import type { Lead } from "@/lib/types";

function baseLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    organizationId: "org-1",
    accountId: "a1",
    contactId: "c1",
    name: "Test",
    company: "Co",
    contactName: "Test",
    companyName: "Co",
    stage: "replied",
    channel: "email",
    temperature: "warm",
    priority: "medium",
    ownerId: "u1",
    touches: 1,
    isIdle: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Lead;
}

describe("shouldOfferReplyIntelligenceRun", () => {
  it("offers on any open lead without a pending action", () => {
    expect(shouldOfferReplyIntelligenceRun(baseLead())).toBe(true);
  });

  it("hides while a pending reply action is active", () => {
    expect(
      shouldOfferReplyIntelligenceRun(
        baseLead({
          lastReplyAt: "2026-08-01T12:00:00.000Z",
          pendingReplyActionId: "act-1",
          replyActionStatus: "pending",
          replyClass: "positive",
          nextAction: "Positive · potential 80: Book a call",
        }),
      ),
    ).toBe(false);
  });

  it("hides for do-not-contact", () => {
    expect(shouldOfferReplyIntelligenceRun(baseLead({ doNotContact: true }))).toBe(false);
  });
});

describe("shouldHighlightMissingReplyNextStep", () => {
  it("highlights when reply signal exists but next step is missing", () => {
    expect(
      shouldHighlightMissingReplyNextStep(
        baseLead({ lastReplyAt: "2026-08-01T12:00:00.000Z" }),
      ),
    ).toBe(true);
  });

  it("does not highlight without a reply signal", () => {
    expect(shouldHighlightMissingReplyNextStep(baseLead())).toBe(false);
  });
});
