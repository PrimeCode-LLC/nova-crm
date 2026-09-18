import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { getDealFromPostgres } from "@/lib/db/list-crm-postgres";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }
  const { dealId } = await ctx.params;
  const id = dealId?.trim();
  if (!id) return NextResponse.json({ error: "dealId required" }, { status: 400 });
  const deal = await getDealFromPostgres(g.ctx.session.organizationId, id);
  if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, deal });
}
