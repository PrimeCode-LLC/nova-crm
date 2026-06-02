import { NextResponse } from "next/server";
import { cronUnauthorized, verifyCronSecret } from "@/lib/scrapers/cron-auth";
import { runAllOrganizationsScrapersDueServer } from "@/lib/scrapers/run-feeds-server";
import { deleteExpiredRawItemsServer } from "@/lib/scrapers/raw-items-server";

export const maxDuration = 300;

export async function GET(req: Request) {
  if (!verifyCronSecret(req)) return cronUnauthorized();

  const { orgCount, results } = await runAllOrganizationsScrapersDueServer();
  const deleted = await deleteExpiredRawItemsServer();
  const newTotal = results.reduce((n, r) => n + r.newCount, 0);

  return NextResponse.json({
    ok: true,
    orgCount,
    feedsRun: results.length,
    newItems: newTotal,
    expiredDeleted: deleted,
  });
}
