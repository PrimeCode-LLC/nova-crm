import { NextResponse } from "next/server";
import { cronUnauthorized, verifyCronSecret } from "@/lib/scrapers/cron-auth";
import { runAllOrganizationsScrapersDueServer } from "@/lib/scrapers/run-feeds-server";
import { cleanupIntakePoolServer } from "@/lib/scrapers/raw-items-server";
import { enqueueScrapersJob } from "@/lib/queue/enqueue";
import { maybeEnqueueHeavyCron } from "@/lib/queue/cron-enqueue";

export const maxDuration = 300;

/**
 * Legacy / rollback path for P1.4.
 * Default: Cloud Functions `runDueScrapers` runs scrape+cleanup when
 * `SCRAPERS_RUNTIME=functions`. Set `SCRAPERS_RUNTIME=apphosting` to restore
 * this App Hosting route as the heavy worker.
 *
 * P4.4: when `QUEUE_HEAVY_JOBS_V1` is on, enqueues BullMQ and returns.
 */
export async function GET(req: Request) {
  if (!verifyCronSecret(req)) return cronUnauthorized();

  const queued = await maybeEnqueueHeavyCron(
    () => enqueueScrapersJob({ mode: "due" }),
    "scrapers",
  );
  if (queued) return queued;

  const { orgCount, results } = await runAllOrganizationsScrapersDueServer();
  const cleanup = await cleanupIntakePoolServer();
  const newTotal = results.reduce((n, r) => n + r.newCount, 0);

  return NextResponse.json({
    ok: true,
    orgCount,
    feedsRun: results.length,
    newItems: newTotal,
    expiredDeleted: cleanup.expiredDeleted,
    staleEpochDeleted: cleanup.staleEpochDeleted,
  });
}
