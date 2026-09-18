import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { getLeadFromPostgres } from "@/lib/db/list-crm-postgres";

/** Phase 4 — GET single lead by id (full payload). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ leadId: string }> },
) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }
  const { leadId } = await ctx.params;
  const id = leadId?.trim();
  if (!id) return NextResponse.json({ error: "leadId required" }, { status: 400 });
  const lead = await getLeadFromPostgres(g.ctx.session.organizationId, id);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, lead });
}
