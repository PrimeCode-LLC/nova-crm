import { describe, expect, it } from "vitest";
import {
  memberCanAccessWorkspaceDoc,
  memberWorkspaceDocSlices,
  workspaceDocSeesAll,
} from "@/lib/db/workspace-document-member-scope";

describe("workspace document member scope", () => {
  it("treats owner, admin, director, and super-admin as tenant-wide", () => {
    expect(workspaceDocSeesAll({ orgRole: "owner" })).toBe(true);
    expect(workspaceDocSeesAll({ orgRole: "admin" })).toBe(true);
    expect(workspaceDocSeesAll({ orgRole: "member", roleId: "director" })).toBe(true);
    expect(workspaceDocSeesAll({ orgRole: "member", isSuperAdmin: true })).toBe(true);
    expect(workspaceDocSeesAll({ orgRole: "member", roleId: "salesperson" })).toBe(false);
  });

  it("scopes follow-ups to owner and manager slices", () => {
    expect(memberWorkspaceDocSlices("followups", "sales-1")).toEqual([
      { kind: "eq", field: "ownerId", value: "sales-1" },
      { kind: "array-contains", field: "ownerManagerIds", value: "sales-1" },
    ]);
  });

  it("allows a follow-up the member owns or manages, and rejects peers", () => {
    expect(memberCanAccessWorkspaceDoc("followups", { ownerId: "sales-1" }, "sales-1")).toBe(true);
    expect(
      memberCanAccessWorkspaceDoc(
        "followups",
        { ownerId: "peer", ownerManagerIds: ["sales-1"] },
        "sales-1",
      ),
    ).toBe(true);
    expect(memberCanAccessWorkspaceDoc("followups", { ownerId: "peer" }, "sales-1")).toBe(false);
  });
});
