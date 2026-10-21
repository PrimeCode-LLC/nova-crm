import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { listMembersServer } from "@/lib/platform/members-server";
import { collectDescendantUserIds } from "@/lib/workspace-hierarchy";
import type { User } from "@/lib/types";
import type { DocumentData } from "@/lib/db/document-shim/shim-firestore";

function asUserMinimal(id: string, raw: DocumentData): User {
  const r = raw as Record<string, unknown>;
  return {
    id,
    email: String(r.email ?? ""),
    displayName: String(r.displayName ?? r.email ?? id),
    roleId: (r.roleId as User["roleId"]) ?? "salesperson",
    managerId: typeof r.managerId === "string" ? r.managerId : undefined,
    organizationId: typeof r.organizationId === "string" ? r.organizationId : undefined,
    orgRole: r.orgRole as User["orgRole"],
    status: (r.status as User["status"]) ?? "active",
    createdAt: "",
  };
}

/**
 * users/{uid} docs written by older onboarding have no name/email, so the
 * mapper falls back to the uid. Fill those from the org member record (QA 2.2)
 * — a read-time fallback, no stored data is rewritten.
 */
async function withMemberNames(organizationId: string, users: User[]): Promise<User[]> {
  const missing = users.filter((u) => !u.displayName.trim() || u.displayName === u.id || !u.email);
  if (missing.length === 0) return users;
  let members: Awaited<ReturnType<typeof listMembersServer>> = [];
  try {
    members = await listMembersServer(organizationId);
  } catch {
    return users;
  }
  const byUid = new Map(members.map((m) => [m.uid, m]));
  return users.map((u) => {
    const m = byUid.get(u.id);
    if (!m) return u;
    const name = u.displayName.trim() && u.displayName !== u.id ? u.displayName : m.displayName?.trim();
    return {
      ...u,
      displayName: name || u.displayName,
      email: u.email || m.email || "",
    };
  });
}

/** Short in-process TTL — Fluid Compute reuses instances; cuts repeated roster reads. */
const ORG_USERS_CACHE_TTL_MS = 30_000;
const orgUsersCache = new Map<string, { expiresAt: number; value: User[] }>();

/** Active org roster for hierarchy checks (server-side). */
export async function listOrgUsersServer(organizationId: string): Promise<User[]> {
  const hit = orgUsersCache.get(organizationId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const db = getAdminDb();
  if (!db) return [];
  const snap = await db
    .collection(COLLECTIONS.users)
    .where("organizationId", "==", organizationId)
    .get();
  const value = await withMemberNames(
    organizationId,
    snap.docs.map((d) => asUserMinimal(d.id, d.data())).filter((u) => u.status === "active"),
  );

  orgUsersCache.set(organizationId, {
    expiresAt: Date.now() + ORG_USERS_CACHE_TTL_MS,
    value,
  });
  if (orgUsersCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of orgUsersCache) {
      if (v.expiresAt <= now) orgUsersCache.delete(k);
    }
  }
  return value;
}

/** True when `viewerUid` is the target or a manager above them in the org chart. */
export function viewerManagesUserServer(
  viewerUid: string,
  targetUid: string,
  orgUsers: readonly User[],
): boolean {
  if (viewerUid === targetUid) return true;
  return collectDescendantUserIds(viewerUid, orgUsers).has(targetUid);
}
