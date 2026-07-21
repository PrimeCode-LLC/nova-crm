import type { User } from "@/lib/types";
import { computeManagerAncestorIds } from "@/lib/user-hierarchy-tree";

/**
 * Manager UIDs who may list CRM rows owned by this user (direct + indirect).
 * Prefer stored `managerAncestorIds`; fall back to walking `managerId`.
 */
export function ownerManagerIdsFromUser(
  owner: Pick<User, "managerId" | "managerAncestorIds"> | null | undefined,
): string[] {
  if (!owner) return [];
  const fromStored = (owner.managerAncestorIds ?? []).filter(
    (id): id is string => typeof id === "string" && id.trim().length > 0,
  );
  if (fromStored.length > 0) {
    return [...new Set(fromStored)];
  }
  const mid = typeof owner.managerId === "string" ? owner.managerId.trim() : "";
  return mid ? [mid] : [];
}

/** Resolve denormalized manager ids for an owner from an in-memory roster. */
export function ownerManagerIdsFromRoster(
  ownerId: string | undefined | null,
  users: readonly User[],
): string[] {
  const oid = typeof ownerId === "string" ? ownerId.trim() : "";
  if (!oid) return [];
  const owner = users.find((u) => u.id === oid);
  if (owner) return ownerManagerIdsFromUser(owner);
  return computeManagerAncestorIds(oid, users);
}
