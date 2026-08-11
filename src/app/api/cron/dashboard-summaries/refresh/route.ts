/**
 * P3.2 — drain dirty Postgres org dashboard summaries (~60s coalesce).
 * Scheduled from Cloud Functions `refreshPostgresDashboardSummaries`.
 * Light work: only orgs marked dirty by lead/deal dual-write.
 *
 * P4.4: when `QUEUE_HEAVY_JOBS_V1` is on, enqueues BullMQ and returns.
 */
import { NextResponse } from "next/server";
import { isPostgresDashboardSummaryWriterEnabled } from "@/lib/db/postgres-dashboard-summary-flags";
import { refreshDirtyOrgDashboardSummariesPostgres } from "@/lib/db/org-dashboard-summary-refresh";
import { cronUnauthorized, verifyCronSecret } from "@/lib/scrapers/cron-auth";
import { enqueueDashboardSummaryJob } from "@/lib/queue/enqueue";
import { maybeEnqueueHeavyCron } from "@/lib/queue/cron-enqueue";

export const maxDuration = 120;

export async function GET(req: Request) {
  if (!verifyCronSecret(req)) return cronUnauthorized();

  const queued = await maybeEnqueueHeavyCron(
    () => enqueueDashboardSummaryJob({ mode: "dirty" }),
    "dashboard-summary",
  );
  if (queued) return queued;

  if (!isPostgresDashboardSummaryWriterEnabled()) {
    return NextResponse.json({
      ok: true,
      enabled: false,
      refreshed: 0,
      skipped: 0,
      failed: 0,
      examined: 0,
    });
  }

  const result = await refreshDirtyOrgDashboardSummariesPostgres({ limit: 20 });
  return NextResponse.json({ ok: true, enabled: true, ...result });
}
