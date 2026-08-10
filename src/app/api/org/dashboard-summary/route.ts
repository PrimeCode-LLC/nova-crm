import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { isDashboardSummariesV1Enabled } from "@/lib/dashboard-summary-flags";
import { getOrgDashboardSummaryServer } from "@/lib/dashboard-summary-server";
import { getPersonDashboardTaskGaugesServer } from "@/lib/dashboard-person-summary-server";

/**
 * P0.6 / P0.11 — read org dashboard summary (Redis → Firestore) + person task gauges.
 * When `dashboard_summaries_v1` is off, returns `{ enabled: false }` so clients keep the live path.
 */
export async function GET() {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  if (!isDashboardSummariesV1Enabled()) {
    return NextResponse.json({
      ok: true,
      enabled: false,
      summary: null,
      person: null,
      source: null,
    });
  }

  const orgId = g.ctx.session.organizationId;
  const uid = g.ctx.session.uid;

  const [result, personResult] = await Promise.all([
    getOrgDashboardSummaryServer(orgId),
    getPersonDashboardTaskGaugesServer(orgId, uid),
  ]);

  if (!result) {
    return NextResponse.json({
      ok: true,
      enabled: true,
      summary: null,
      person: personResult?.gauges ?? null,
      personSource: personResult?.source ?? null,
      source: null,
    });
  }

  return NextResponse.json({
    ok: true,
    enabled: true,
    summary: result.summary,
    source: result.source,
    person: personResult?.gauges ?? null,
    personSource: personResult?.source ?? null,
  });
}
