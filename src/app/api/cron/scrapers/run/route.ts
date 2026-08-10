import { NextResponse } from "next/server";
import { cronUnauthorized, verifyCronSecret } from "@/lib/scrapers/cron-auth";
import { runAllOrganizationsScrapersDueServer } from "@/lib/scrapers/run-feeds-server";
import { cleanupIntakePoolServer } from "@/lib/scrapers/raw-items-server";

export const maxDuration = 300;

/**
 * Legacy / rollback path for P1.4.
 * Default: Cloud Functions `runDueScrapers` runs scrape+cleanup when
 * `SCRAPERS_RUNTIME=functions`. Set `SCRAPERS_RUNTIME=apphosting` to restore
 * this App Hosting route as the heavy worker.
 */
export async function GET(req: Request) {
  if (!verifyCronSecret(req)) return cronUnauthorized();

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
