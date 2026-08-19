import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  getOpportunityScanServer,
  viewerIsElevatedForFitScans,
} from "@/lib/ai/opportunity-fit-server";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { Role } from "@/lib/types";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const orgId = g.ctx.session.organizationId;
  const uid = g.ctx.session.uid;

  const db = getAdminDb();
  const userSnap = await db?.collection(COLLECTIONS.users).doc(uid).get();
  const userData = userSnap?.data();
  const roleId = userData?.roleId as Role | undefined;
  const elevated = viewerIsElevatedForFitScans({
    orgRole: g.ctx.role,
    roleId,
    isSuperAdmin: userData?.isSuperAdmin === true,
  });

  const scan = await getOpportunityScanServer({
    organizationId: orgId,
    scanId: id,
    viewerUserId: uid,
    elevated,
  });

  if (!scan) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ scan });
}
