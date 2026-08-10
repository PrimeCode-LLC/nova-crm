import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { isDashboardSummariesV1Enabled } from "@/lib/dashboard-summary-flags";
import { getContentOpsSummaryServer } from "@/lib/content-ops-summary-server";

/**
 * P0.12 — content-ops KPI summary (Redis → Firestore recount).
 * When `dashboard_summaries_v1` is off, returns `{ enabled: false }`.
 */
export async function GET() {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  if (!isDashboardSummariesV1Enabled()) {
    return NextResponse.json({ ok: true, enabled: false, org: null, person: null });
  }

  const result = await getContentOpsSummaryServer(
    g.ctx.session.organizationId,
    g.ctx.session.uid,
  );

  if (!result) {
    return NextResponse.json({
      ok: true,
      enabled: true,
      org: null,
      person: null,
      source: null,
    });
  }

  return NextResponse.json({
    ok: true,
    enabled: true,
    org: result.org,
    person: result.person,
    source: result.source,
  });
}
