import { NextResponse } from "next/server";
import { cronUnauthorized, verifyCronSecret } from "@/lib/scrapers/cron-auth";
import { backupOnlyCronSkipResponse } from "@/lib/platform/backup-only-cron";
import { runAllOrganizationsScrapersDueServer } from "@/lib/scrapers/run-feeds-server";
import { cleanupIntakePoolServer } from "@/lib/scrapers/raw-items-server";

export const maxDuration = 300;

export async function GET(req: Request) {
  if (!verifyCronSecret(req)) return cronUnauthorized();
  const skipped = await backupOnlyCronSkipResponse("scrapers/run");
  if (skipped) return skipped;

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
