import { NextResponse } from "next/server";
import { cronUnauthorized, verifyCronSecret } from "@/lib/scrapers/cron-auth";
import { backupOnlyCronSkipResponse } from "@/lib/platform/backup-only-cron";
import { processDueScheduledEmailsServer } from "@/lib/email/scheduled-emails-server";

export const maxDuration = 300;

export async function GET(req: Request) {
  if (!verifyCronSecret(req)) return cronUnauthorized();
  const skipped = await backupOnlyCronSkipResponse("scheduled-emails/send");
  if (skipped) return skipped;

  const result = await processDueScheduledEmailsServer();
  return NextResponse.json({ ok: true, ...result });
}
