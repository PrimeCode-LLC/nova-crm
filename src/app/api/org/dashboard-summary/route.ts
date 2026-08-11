import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { isDashboardSummariesV1Enabled } from "@/lib/dashboard-summary-flags";
import { getOrgDashboardSummaryServer } from "@/lib/dashboard-summary-server";
import { getPersonDashboardTaskGaugesServer } from "@/lib/dashboard-person-summary-server";
import { isPostgresDashboardSummaryReadEnabled } from "@/lib/db/postgres-dashboard-summary-flags";
import { getOrgDashboardSummaryFromPostgres } from "@/lib/db/org-dashboard-summary-read";

/**
 * P0.6 / P3.3 / P3.4 — read org dashboard summary + person task gauges.
 *
 * Enablement: Phase 3 Postgres read and/or Phase 0 Firestore read (rollback).
 * P3.4: when Postgres read is on, Postgres is sole source (no Firestore fallback).
 */
export async function GET() {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const pgRead = isPostgresDashboardSummaryReadEnabled();
  const fsRead = isDashboardSummariesV1Enabled();
  if (!pgRead && !fsRead) {
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

  const [summaryResult, personResult] = await Promise.all([
    (async () => {
      if (pgRead) {
        // P3.4 — Postgres is SoT; do not fall back to Firestore.
        return getOrgDashboardSummaryFromPostgres(orgId);
      }
      return getOrgDashboardSummaryServer(orgId);
    })(),
    getPersonDashboardTaskGaugesServer(orgId, uid),
  ]);

  if (!summaryResult) {
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
    summary: summaryResult.summary,
    source: summaryResult.source,
    person: personResult?.gauges ?? null,
    personSource: personResult?.source ?? null,
  });
}
