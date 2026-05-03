import type { ActivityCounterRow, ActivityRecord, Lead, User } from "@/lib/types";

/** `Select` value prefix for filtering to a single `ownerId` (Firebase uid). */
export const OWNER_SCOPE_PREFIX = "owner:";

export type OwnerScopeDeps = {
  currentUserId: string;
  users: readonly User[];
  getUserById: (id: string) => User | undefined;
  getOwnerDisplayName: (id: string) => string | undefined;
};

export function filterLeadsByOwnerScope(
  leads: readonly Lead[],
  ownerScope: string,
  deps: OwnerScopeDeps,
): Lead[] {
  const { currentUserId, users, getUserById, getOwnerDisplayName } = deps;
  if (ownerScope === "all-owners") return [...leads];
  if (ownerScope === "me") return leads.filter((l) => l.ownerId === currentUserId);
  if (ownerScope === "unassigned") {
    return leads.filter((l) => {
      const oid = l.ownerId?.trim();
      if (!oid) return true;
      return !getUserById(oid) && !getOwnerDisplayName(oid);
    });
  }
  if (ownerScope === "team") {
    const peerIds = new Set(users.filter((u) => u.id !== currentUserId).map((u) => u.id));
    return leads.filter((l) => peerIds.has(l.ownerId));
  }
  if (ownerScope.startsWith(OWNER_SCOPE_PREFIX)) {
    const uid = ownerScope.slice(OWNER_SCOPE_PREFIX.length);
    return leads.filter((l) => l.ownerId === uid);
  }
  return [...leads];
}

export function buildPersonOwnerOptions(
  leads: readonly Lead[],
  users: readonly User[],
  getUserById: (id: string) => User | undefined,
  getOwnerDisplayName: (id: string) => string | undefined,
): { id: string; label: string }[] {
  const map = new Map<string, string>();
  for (const l of leads) {
    const id = l.ownerId?.trim();
    if (!id) continue;
    const label =
      getUserById(id)?.displayName?.trim() || getOwnerDisplayName(id)?.trim() || "";
    if (label) map.set(id, label);
  }
  for (const u of users) {
    if (u.status === "inactive") continue;
    if (!map.has(u.id)) {
      map.set(
        u.id,
        u.displayName?.trim() || getOwnerDisplayName(u.id)?.trim() || u.email.split("@")[0] || u.id,
      );
    }
  }
  return [...map.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function getOwnerFilterTriggerLabel(
  ownerScope: string,
  personOwnerOptions: readonly { id: string; label: string }[],
): string {
  if (ownerScope === "all-owners") return "All owners";
  if (ownerScope === "me") return "Owned by me";
  if (ownerScope === "team") return "My team";
  if (ownerScope === "unassigned") return "Unassigned";
  if (ownerScope.startsWith(OWNER_SCOPE_PREFIX)) {
    const uid = ownerScope.slice(OWNER_SCOPE_PREFIX.length);
    return personOwnerOptions.find((o) => o.id === uid)?.label ?? "One owner";
  }
  return "All owners";
}

/** Activity rollups are keyed by integration user; narrow to the same owner scope as leads. */
export function filterActivityCountersByOwnerScope(
  rows: readonly ActivityCounterRow[],
  ownerScope: string,
  deps: OwnerScopeDeps,
): ActivityCounterRow[] {
  const { currentUserId, users } = deps;
  if (ownerScope === "all-owners" || ownerScope === "unassigned") return [...rows];
  if (ownerScope === "me") return rows.filter((r) => r.userId === currentUserId);
  if (ownerScope === "team") {
    const peerIds = new Set(users.filter((u) => u.id !== currentUserId).map((u) => u.id));
    return rows.filter((r) => peerIds.has(r.userId));
  }
  if (ownerScope.startsWith(OWNER_SCOPE_PREFIX)) {
    const uid = ownerScope.slice(OWNER_SCOPE_PREFIX.length);
    return rows.filter((r) => r.userId === uid);
  }
  return [...rows];
}

export function filterActivityRecordsByOwnerScope(
  records: readonly ActivityRecord[],
  ownerScope: string,
  deps: OwnerScopeDeps,
): ActivityRecord[] {
  const { currentUserId, users } = deps;
  if (ownerScope === "all-owners" || ownerScope === "unassigned") return [...records];
  if (ownerScope === "me") return records.filter((r) => r.userId === currentUserId);
  if (ownerScope === "team") {
    const peerIds = new Set(users.filter((u) => u.id !== currentUserId).map((u) => u.id));
    return records.filter((r) => peerIds.has(r.userId));
  }
  if (ownerScope.startsWith(OWNER_SCOPE_PREFIX)) {
    const uid = ownerScope.slice(OWNER_SCOPE_PREFIX.length);
    return records.filter((r) => r.userId === uid);
  }
  return [...records];
}
