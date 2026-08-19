import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { canManageOrgHierarchy } from "@/lib/can-manage-org-users";
import { listOrgUsersServer } from "@/lib/platform/hierarchy-access-server";
import { restampOwnerManagerIdsForOrgUsers } from "@/lib/documents/restamp-owner-manager-ids-server";

/**
 * Backfill denormalized ownerManagerIds / leadOwnerManagerIds / userManagerIds
 * from current org hierarchy (for manager live list queries).
 */
export async function POST() {
  const g = await guardTenantApi({ minRole: "admin" });
  if (!g.ok) return g.response;

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json(
      { error: "Document store is not configured (DATABASE_URL missing)." },
      { status: 503 },
    );
  }

  const orgId = g.ctx.session.organizationId;
  const orgUsers = await listOrgUsersServer(orgId);
  const actor = orgUsers.find((u) => u.id === g.ctx.session.uid);
  if (!canManageOrgHierarchy(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const restamp = await restampOwnerManagerIdsForOrgUsers({
    db,
    organizationId: orgId,
    users: orgUsers.map((u) => ({
      id: u.id,
      managerId: u.managerId,
      managerAncestorIds: u.managerAncestorIds,
    })),
  });

  return NextResponse.json({ ok: true, crmDocsUpdated: restamp.updated });
}
