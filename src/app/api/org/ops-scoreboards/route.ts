import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { isDashboardSummariesV1Enabled } from "@/lib/dashboard-summary-flags";
import { isPostgresDashboardSummaryReadEnabled } from "@/lib/db/postgres-dashboard-summary-flags";
import {
  getOpsScoreboardsServer,
  isOpsScoreboardsRange,
} from "@/lib/ops-scoreboards-server";
import { parseDashboardTimeRangeKey } from "@/lib/dashboard-date-range";

/**
 * P0.13 — Team Command / Strategy / Inbox / Person scorecard rows (Redis → Admin recount).
 * Query: `?range=30d` (defaults to 30d).
 * Enabled when Postgres dashboard summaries OR Phase 0 Firestore rollback is on.
 */
export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  if (!isPostgresDashboardSummaryReadEnabled() && !isDashboardSummariesV1Enabled()) {
    return NextResponse.json({ ok: true, enabled: false, payload: null, source: null });
  }

  const url = new URL(req.url);
  const range = parseDashboardTimeRangeKey(url.searchParams.get("range"), "30d");
  if (!isOpsScoreboardsRange(range)) {
    return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  }

  const result = await getOpsScoreboardsServer(g.ctx.session.organizationId, range);
  if (!result) {
    return NextResponse.json({
      ok: true,
      enabled: true,
      payload: null,
      source: null,
    });
  }

  return NextResponse.json({
    ok: true,
    enabled: true,
    payload: result.payload,
    source: result.source,
  });
}
