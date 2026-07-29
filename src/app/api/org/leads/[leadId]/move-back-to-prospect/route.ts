import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { moveBackToProspectServer } from "@/lib/prospects/move-back-to-prospect-server";

type RouteCtx = { params: Promise<{ leadId: string }> };

export async function POST(_req: Request, ctx: RouteCtx) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const { leadId } = await ctx.params;

  if (!leadId?.trim()) {
    return NextResponse.json({ error: "Lead id required" }, { status: 400 });
  }

  const result = await moveBackToProspectServer({
    organizationId: g.ctx.session.organizationId,
    leadId: leadId.trim(),
    userId: g.ctx.session.uid,
    orgRole: g.ctx.role,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
