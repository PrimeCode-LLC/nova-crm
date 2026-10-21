import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { viewerCanSeeCrmRecord } from "@/lib/db/crm-record-scope";
import { crmModuleAllowedServer } from "@/lib/platform/guard-admin-feature";
import { getContactFromPostgres } from "@/lib/db/list-crm-postgres";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ contactId: string }> },
) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }
  const { contactId } = await ctx.params;
  const id = contactId?.trim();
  if (!id) return NextResponse.json({ error: "contactId required" }, { status: 400 });
  const contact = await getContactFromPostgres(g.ctx.session.organizationId, id);
  if (!contact) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const viewer = {
    organizationId: g.ctx.session.organizationId,
    uid: g.ctx.session.uid,
    orgRole: g.ctx.role,
  };
  const visible =
    (await crmModuleAllowedServer(g.ctx, "contact", ["view"])) &&
    (await viewerCanSeeCrmRecord(viewer, { entity: "contact", value: contact }));
  if (!visible) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, contact });
}
