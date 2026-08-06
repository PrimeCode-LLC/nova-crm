import { describe, expect, it } from "vitest";
import { shouldOfferReplyIntelligenceRun } from "@/lib/email/reply-intelligence-run-visibility";
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
  it("offers when a reply exists but classify never ran", () => {
    expect(
      shouldOfferReplyIntelligenceRun(baseLead({ lastReplyAt: "2026-08-01T12:00:00.000Z" })),
    ).toBe(true);
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

  it("offers again after dismiss", () => {
    expect(
      shouldOfferReplyIntelligenceRun(
        baseLead({
          lastReplyAt: "2026-08-01T12:00:00.000Z",
          replyActionStatus: "dismissed",
          replyClass: "neutral",
          nextAction: "Neutral · potential 40: Nurture",
        }),
      ),
    ).toBe(true);
  });

  it("hides after an accepted/sent resolution with a next action", () => {
    expect(
      shouldOfferReplyIntelligenceRun(
        baseLead({
          lastReplyAt: "2026-08-01T12:00:00.000Z",
          replyActionStatus: "sent",
          replyClass: "positive",
          nextAction: "Reply sent — wait for their response",
        }),
      ),
    ).toBe(false);
  });

  it("hides when there is no reply signal", () => {
    expect(shouldOfferReplyIntelligenceRun(baseLead())).toBe(false);
  });
});
