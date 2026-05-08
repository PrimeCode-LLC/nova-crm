import type { ActivityCounterRow, ActivityRecord, Followup, Lead, User } from "@/lib/types";

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
  if (ownerScope === "open-queue") {
    return leads.filter((l) => !l.ownerId?.trim());
  }
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

/** Narrow followups by assignee (`ownerId`), same semantics as `filterLeadsByOwnerScope`. */
export function filterFollowupsByOwnerScope(
  followups: readonly Followup[],
  ownerScope: string,
  deps: OwnerScopeDeps,
): Followup[] {
  const { currentUserId, users, getUserById, getOwnerDisplayName } = deps;
  if (ownerScope === "all-owners") return [...followups];
  if (ownerScope === "open-queue") return [...followups];
  if (ownerScope === "me") return followups.filter((f) => f.ownerId === currentUserId);
  if (ownerScope === "unassigned") {
    return followups.filter((f) => {
      const oid = f.ownerId?.trim();
      if (!oid) return true;
      return !getUserById(oid) && !getOwnerDisplayName(oid);
    });
  }
  if (ownerScope === "team") {
    const peerIds = new Set(users.filter((u) => u.id !== currentUserId).map((u) => u.id));
    return followups.filter((f) => peerIds.has(f.ownerId));
  }
  if (ownerScope.startsWith(OWNER_SCOPE_PREFIX)) {
    const uid = ownerScope.slice(OWNER_SCOPE_PREFIX.length);
    return followups.filter((f) => f.ownerId === uid);
  }
  return [...followups];
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

/** When CRM `users` rows lack names, avoid showing a long Firebase uid in `<Select>` triggers. */
export function fallbackOwnerPickerLabel(uid: string): string {
  const t = uid.trim();
  if (!t) return "Unknown member";
  if (t.length <= 14) return t;
  return `Member (…${t.slice(-6)})`;
}

/** Resolve label for an owner `<Select>` trigger from built options (or short fallback). */
export function ownerPickerTriggerLabel(
  uid: string | undefined,
  options: readonly { id: string; label: string }[],
): string {
  if (uid == null || uid === "") return "Open queue (anyone can claim)";
  const hit = options.find((o) => o.id === uid);
  if (hit) return hit.label === uid ? fallbackOwnerPickerLabel(uid) : hit.label;
  return fallbackOwnerPickerLabel(uid);
}

/**
 * Labels for workspace-member owner `<Select>`s (profiles, quick-add, etc.).
 * Ensures `currentUserId` and any `ensureIds` have a `SelectItem` with non-empty text so Radix does not
 * fall back to showing the raw Firebase uid (happens when the viewer is in org auth but not in `users`).
 */
export function buildWorkspaceOwnerPickerOptions(
  users: readonly User[],
  currentUserId: string,
  getOwnerDisplayName: (uid: string) => string | undefined,
  ensureIds: readonly string[] = [],
  labelOverrides: Readonly<Record<string, string>> = {},
): { id: string; label: string }[] {
  const byId = new Map<string, string>();
  for (const u of users) {
    if (u.status === "inactive") continue;
    const label =
      u.displayName?.trim() ||
      getOwnerDisplayName(u.id)?.trim() ||
      u.email.split("@")[0]?.trim() ||
      fallbackOwnerPickerLabel(u.id);
    byId.set(u.id, label);
  }
  const uid = currentUserId?.trim();
  if (uid && !byId.has(uid)) {
    const label =
      getOwnerDisplayName(uid)?.trim() ||
      users.find((u) => u.id === uid)?.displayName?.trim() ||
      "You";
    byId.set(uid, label);
  }
  for (const raw of ensureIds) {
    const id = raw?.trim();
    if (!id || byId.has(id)) continue;
    const u = users.find((x) => x.id === id);
    const label =
      u?.displayName?.trim() ||
      getOwnerDisplayName(id)?.trim() ||
      u?.email.split("@")[0]?.trim() ||
      fallbackOwnerPickerLabel(id);
    byId.set(id, label);
  }
  for (const [id, raw] of Object.entries(labelOverrides)) {
    const idt = id?.trim();
    const lab = raw?.trim();
    if (idt && lab) byId.set(idt, lab);
  }
  return [...byId.entries()]
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
  if (ownerScope === "open-queue") return "Open queue";
  if (ownerScope === "unassigned") return "Orphan owner";
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
  if (ownerScope === "all-owners" || ownerScope === "unassigned" || ownerScope === "open-queue") return [...rows];
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
  if (ownerScope === "all-owners" || ownerScope === "unassigned" || ownerScope === "open-queue") return [...records];
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
