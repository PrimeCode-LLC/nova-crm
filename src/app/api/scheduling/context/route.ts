import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getOrganizationServer } from "@/lib/platform/organizations-server";
import { calendarOAuthConfigured } from "@/lib/scheduling/calendar-connection-server";

export async function GET() {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const org = await getOrganizationServer(g.ctx.session.organizationId);
  const oauth = calendarOAuthConfigured();
  return NextResponse.json({
    ok: true,
    orgSlug: org?.slug ?? "org",
    orgName: org?.name ?? "Organization",
    viewerName: g.ctx.session.name ?? g.ctx.session.email?.split("@")[0] ?? "You",
    oauth,
  });
}
