import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  listOpportunityScansServer,
  viewerIsElevatedForFitScans,
} from "@/lib/ai/opportunity-fit-server";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { Role } from "@/lib/types";

export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const orgId = g.ctx.session.organizationId;
  const uid = g.ctx.session.uid;
  const url = new URL(req.url);
  const filterUserId = url.searchParams.get("userId") ?? undefined;

  const db = getAdminDb();
  const userSnap = await db?.collection(COLLECTIONS.users).doc(uid).get();
  const userData = userSnap?.data();
  const roleId = userData?.roleId as Role | undefined;
  const elevated = viewerIsElevatedForFitScans({
    orgRole: g.ctx.role,
    roleId,
    isSuperAdmin: userData?.isSuperAdmin === true,
  });

  const scans = await listOpportunityScansServer({
    organizationId: orgId,
    viewerUserId: uid,
    elevated,
    filterUserId: elevated ? filterUserId : undefined,
  });

  return NextResponse.json({ scans, elevated });
}
