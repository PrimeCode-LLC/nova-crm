import { describe, expect, it } from "vitest";
import type { User } from "@/lib/types";
import {
  leadOwnerIdsVisibleToViewer,
  seesAllLeadsInTenant,
} from "@/lib/workspace-hierarchy";

const NOW = "2026-07-21T00:00:00.000Z";

function user(id: string, patch: Partial<User> = {}): User {
  return {
    id,
    email: `${id}@example.com`,
    displayName: id,
    roleId: "salesperson",
    status: "active",
    createdAt: NOW,
    ...patch,
  };
}

describe("workspace hierarchy visibility", () => {
  it("includes direct and indirect reports", () => {
    const manager = user("manager", { roleId: "manager" });
    const direct = user("direct", { managerId: manager.id });
    const indirect = user("indirect", { managerId: direct.id });

    expect(
      [...leadOwnerIdsVisibleToViewer(manager, [manager, direct, indirect])].sort(),
    ).toEqual(["direct", "indirect", "manager"]);
  });

  it("does not grant peer access from optional team membership", () => {
    const viewer = user("viewer", { departmentId: "team-sales" });
    const peer = user("peer", { departmentId: "team-sales" });

    expect(leadOwnerIdsVisibleToViewer(viewer, [viewer, peer])).toEqual(
      new Set(["viewer"]),
    );
  });

  it("does not give workspace managers tenant-wide CRM access", () => {
    expect(seesAllLeadsInTenant(user("manager", { orgRole: "manager" }))).toBe(
      false,
    );
    expect(seesAllLeadsInTenant(user("admin", { orgRole: "admin" }))).toBe(true);
  });
});
