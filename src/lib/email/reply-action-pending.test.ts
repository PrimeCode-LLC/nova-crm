import { describe, expect, it } from "vitest";
import {
  hasPendingReplyAction,
  isReplyActionCloseLost,
  shouldSuppressReplyReviewForHardNo,
} from "@/lib/email/reply-action-pending";
import { hasPendingReplyReview } from "@/lib/leads/reply-review";
import type { Lead } from "@/lib/types";

function lead(partial: Partial<Lead>): Lead {
  return {
    id: "l1",
    accountId: "a",
    contactId: "c",
    channel: "email",
    stage: "contacted",
    temperature: "warm",
    priority: "medium",
    ownerId: "u1",
    contactName: "A",
    companyName: "B",
    touches: 1,
    isIdle: false,
    createdAt: "",
    updatedAt: "",
    ...partial,
  } as Lead;
}

describe("hasPendingReplyAction", () => {
  it("requires pending id and status", () => {
    expect(hasPendingReplyAction(lead({}))).toBe(false);
    expect(
      hasPendingReplyAction(lead({ pendingReplyActionId: "x", replyActionStatus: "sent" })),
    ).toBe(false);
    expect(
      hasPendingReplyAction(lead({ pendingReplyActionId: "x", replyActionStatus: "pending" })),
    ).toBe(true);
  });
});

describe("isReplyActionCloseLost", () => {
  it("detects hard_no and close_lost", () => {
    expect(isReplyActionCloseLost({ classification: "hard_no" })).toBe(true);
    expect(isReplyActionCloseLost({ recommendedAction: "close_lost" })).toBe(true);
    expect(isReplyActionCloseLost({ classification: "positive" })).toBe(false);
  });
});

describe("shouldSuppressReplyReviewForHardNo", () => {
  it("suppresses promote review for hard_no even without pending AI action", () => {
    expect(
      shouldSuppressReplyReviewForHardNo(
        lead({
          replyClass: "hard_no",
          replyReviewStatus: "pending",
          intakeKind: "prospect",
        }),
      ),
    ).toBe(true);
  });

  it("does not suppress for positive replies", () => {
    expect(shouldSuppressReplyReviewForHardNo(lead({ replyClass: "positive" }))).toBe(false);
  });
});

describe("hasPendingReplyReview with hard_no", () => {
  it("hides reply review when classified hard_no", () => {
    expect(
      hasPendingReplyReview(
        lead({
          intakeKind: "prospect",
          stage: "new",
          replyReviewStatus: "pending",
          pendingReplyActionId: "ra1",
          replyActionStatus: "pending",
          replyClass: "hard_no",
        }),
      ),
    ).toBe(false);
  });

  it("still shows reply review for positive AI actions", () => {
    expect(
      hasPendingReplyReview(
        lead({
          intakeKind: "prospect",
          stage: "new",
          replyReviewStatus: "pending",
          pendingReplyActionId: "ra1",
          replyActionStatus: "pending",
          replyClass: "positive",
        }),
      ),
    ).toBe(true);
  });
});
