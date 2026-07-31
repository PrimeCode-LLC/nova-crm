import { describe, expect, it } from "vitest";
import {
  filterReplyActionsVisibleToViewer,
  replyActionVisibleToViewer,
  type ReplyActionAnalyticsRow,
} from "@/lib/email/reply-action-analytics";
import type { User } from "@/lib/types";

function user(partial: Partial<User> & Pick<User, "id" | "roleId">): User {
  return {
    email: `${partial.id}@example.com`,
    displayName: partial.id,
    status: "active",
    createdAt: "",
    ...partial,
  };
}

function row(
  partial: Partial<ReplyActionAnalyticsRow> &
    Pick<ReplyActionAnalyticsRow, "id" | "leadId" | "leadOwnerId">,
): ReplyActionAnalyticsRow {
  return {
    organizationId: "org",
    mailboxId: "mb",
    inboundProviderKey: "imap",
    status: "pending",
    classification: "objection",
    potentialScore: 40,
    recommendedAction: "reply_now",
    rationale: "",
    nextStepSummary: "",
    source: "system",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    outcome: "open",
    ...partial,
  };
}

describe("replyActionVisibleToViewer", () => {
  const salesA = user({ id: "sales-a", roleId: "salesperson", orgRole: "member" });
  const salesB = user({ id: "sales-b", roleId: "salesperson", orgRole: "member", managerId: "mgr" });
  const manager = user({ id: "mgr", roleId: "manager", orgRole: "manager" });
  const director = user({ id: "dir", roleId: "director", orgRole: "admin" });
  const orgUsers = [salesA, salesB, manager, director];

  it("lets directors see all org actions", () => {
    expect(
      replyActionVisibleToViewer(row({ id: "1", leadId: "l1", leadOwnerId: "sales-a" }), director, orgUsers),
    ).toBe(true);
  });

  it("lets salespeople see only their owned leads", () => {
    expect(
      replyActionVisibleToViewer(row({ id: "1", leadId: "l1", leadOwnerId: "sales-a" }), salesA, orgUsers),
    ).toBe(true);
    expect(
      replyActionVisibleToViewer(row({ id: "2", leadId: "l2", leadOwnerId: "sales-b" }), salesA, orgUsers),
    ).toBe(false);
  });

  it("lets managers see report-owned leads", () => {
    expect(
      replyActionVisibleToViewer(row({ id: "1", leadId: "l1", leadOwnerId: "sales-b" }), manager, orgUsers),
    ).toBe(true);
    expect(
      replyActionVisibleToViewer(row({ id: "2", leadId: "l2", leadOwnerId: "sales-a" }), manager, orgUsers),
    ).toBe(false);
  });

  it("allows shared ownership", () => {
    expect(
      replyActionVisibleToViewer(
        row({
          id: "1",
          leadId: "l1",
          leadOwnerId: "sales-b",
          leadSharedOwnerIds: ["sales-a"],
        }),
        salesA,
        orgUsers,
      ),
    ).toBe(true);
  });

  it("hides unassigned leads from salespeople", () => {
    expect(
      replyActionVisibleToViewer(row({ id: "1", leadId: "l1", leadOwnerId: "" }), salesA, orgUsers),
    ).toBe(false);
  });

  it("filters lists for non-elevated viewers", () => {
    const rows = [
      row({ id: "1", leadId: "l1", leadOwnerId: "sales-a" }),
      row({ id: "2", leadId: "l2", leadOwnerId: "sales-b" }),
    ];
    expect(filterReplyActionsVisibleToViewer(rows, salesA, orgUsers).map((r) => r.id)).toEqual([
      "1",
    ]);
    expect(filterReplyActionsVisibleToViewer(rows, director, orgUsers)).toHaveLength(2);
  });
});
