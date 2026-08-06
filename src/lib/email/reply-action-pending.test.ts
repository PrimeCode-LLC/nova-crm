import { describe, expect, it } from "vitest";
import { hasPendingReplyAction } from "@/lib/email/reply-action-pending";
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
