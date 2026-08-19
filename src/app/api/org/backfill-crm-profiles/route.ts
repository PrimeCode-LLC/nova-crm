import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getAdminDb } from "@/lib/firebase/admin";
import { listMembersServer } from "@/lib/platform/members-server";
import { backfillOrgCrmProfilesServer } from "@/lib/platform/crm-profile-provision";

/**
 * Backfill missing CRM profiles for every active member in the current workspace.
 * Owners/admins only. Idempotent — safe to run multiple times.
 */
export async function POST() {
  const g = await guardTenantApi({ minRole: "admin" });
  if (!g.ok) return g.response;

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json(
      { error: "Firebase Admin is not configured." },
      { status: 503 },
    );
  }

  const orgId = g.ctx.session.organizationId;
  const members = await listMembersServer(orgId);
  const summary = await backfillOrgCrmProfilesServer(db, orgId, members, {
    actorUid: g.ctx.session.uid,
    forceRoleSync: true,
  });

  return NextResponse.json(summary);
}
