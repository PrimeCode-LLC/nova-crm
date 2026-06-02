import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { canManageOrgHierarchy } from "@/lib/can-manage-org-users";
import { listOrgUsersServer } from "@/lib/platform/hierarchy-access-server";
import { buildOrgManagerAncestorIdsMap } from "@/lib/user-hierarchy-tree";

/**
 * Recomputes `managerAncestorIds` for every user in the tenant from current `managerId` links.
 * Use after bulk imports or if managers cannot see reports in live mode.
 */
export async function POST() {
  const g = await guardTenantApi({ minRole: "admin" });
  if (!g.ok) return g.response;

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json(
      { error: "Firebase Admin is not configured on this server." },
      { status: 503 },
    );
  }

  const orgId = g.ctx.session.organizationId;
  const orgUsers = await listOrgUsersServer(orgId);
  const actor = orgUsers.find((u) => u.id === g.ctx.session.uid);
  if (!canManageOrgHierarchy(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ancestorMap = buildOrgManagerAncestorIdsMap(orgUsers);
  const batch = db.batch();
  for (const u of orgUsers) {
    const ancestors = ancestorMap.get(u.id) ?? [];
    batch.update(db.collection(COLLECTIONS.users).doc(u.id), {
      managerAncestorIds: ancestors,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  return NextResponse.json({ ok: true, updated: orgUsers.length });
}
