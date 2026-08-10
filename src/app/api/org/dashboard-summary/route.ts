import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { isDashboardSummariesV1Enabled } from "@/lib/dashboard-summary-flags";
import { getOrgDashboardSummaryServer } from "@/lib/dashboard-summary-server";

/**
 * P0.6 — read org dashboard summary (Redis → Firestore).
 * When `dashboard_summaries_v1` is off, returns `{ enabled: false }` so clients keep the live path.
 */
export async function GET() {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  if (!isDashboardSummariesV1Enabled()) {
    return NextResponse.json({ ok: true, enabled: false, summary: null, source: null });
  }

  const result = await getOrgDashboardSummaryServer(g.ctx.session.organizationId);
  if (!result) {
    return NextResponse.json({
      ok: true,
      enabled: true,
      summary: null,
      source: null,
    });
  }

  return NextResponse.json({
    ok: true,
    enabled: true,
    summary: result.summary,
    source: result.source,
  });
}
