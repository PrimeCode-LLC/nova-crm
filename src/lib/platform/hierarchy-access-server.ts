import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { collectDescendantUserIds } from "@/lib/workspace-hierarchy";
import type { User } from "@/lib/types";
import type { DocumentData } from "firebase-admin/firestore";

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

/** Active org roster for hierarchy checks (server-side). */
export async function listOrgUsersServer(organizationId: string): Promise<User[]> {
  const db = getAdminDb();
  if (!db) return [];
  const snap = await db
    .collection(COLLECTIONS.users)
    .where("organizationId", "==", organizationId)
    .get();
  return snap.docs
    .map((d) => asUserMinimal(d.id, d.data()))
    .filter((u) => u.status === "active");
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
