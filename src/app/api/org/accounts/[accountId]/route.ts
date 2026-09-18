import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { getAccountFromPostgres } from "@/lib/db/list-crm-postgres";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ accountId: string }> },
) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }
  const { accountId } = await ctx.params;
  const id = accountId?.trim();
  if (!id) return NextResponse.json({ error: "accountId required" }, { status: 400 });
  const account = await getAccountFromPostgres(g.ctx.session.organizationId, id);
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, account });
}
