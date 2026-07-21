import { describe, expect, it } from "vitest";
import {
  ownerManagerIdsFromRoster,
  ownerManagerIdsFromUser,
} from "@/lib/crm-owner-managers";
import type { User } from "@/lib/types";

function user(
  partial: Partial<User> & Pick<User, "id">,
): User {
  return {
    id: partial.id,
    email: partial.email ?? `${partial.id}@test.com`,
    displayName: partial.displayName ?? partial.id,
    roleId: partial.roleId ?? "member",
    organizationId: partial.organizationId ?? "org-1",
    status: partial.status ?? "active",
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
    managerId: partial.managerId,
    managerAncestorIds: partial.managerAncestorIds,
  };
}

describe("ownerManagerIdsFromUser", () => {
  it("returns empty for missing owner", () => {
    expect(ownerManagerIdsFromUser(null)).toEqual([]);
    expect(ownerManagerIdsFromUser(undefined)).toEqual([]);
  });

  it("prefers managerAncestorIds over managerId", () => {
    expect(
      ownerManagerIdsFromUser({
        managerId: "mgr-direct",
        managerAncestorIds: ["mgr-a", "mgr-b", "mgr-a"],
      }),
    ).toEqual(["mgr-a", "mgr-b"]);
  });

  it("falls back to managerId when ancestors are empty", () => {
    expect(
      ownerManagerIdsFromUser({
        managerId: "mgr-direct",
        managerAncestorIds: [],
      }),
    ).toEqual(["mgr-direct"]);
  });
});

describe("ownerManagerIdsFromRoster", () => {
  const roster = [
    user({ id: "director", managerAncestorIds: [] }),
    user({ id: "mgr", managerId: "director", managerAncestorIds: ["director"] }),
    user({
      id: "rep",
      managerId: "mgr",
      managerAncestorIds: ["mgr", "director"],
    }),
  ];

  it("returns empty for blank ownerId", () => {
    expect(ownerManagerIdsFromRoster("", roster)).toEqual([]);
    expect(ownerManagerIdsFromRoster(null, roster)).toEqual([]);
  });

  it("resolves from roster user fields", () => {
    expect(ownerManagerIdsFromRoster("rep", roster)).toEqual(["mgr", "director"]);
  });
});
