import { NextResponse } from "next/server";
import { cronUnauthorized, verifyCronSecret } from "@/lib/scrapers/cron-auth";
import { backupOnlyCronSkipResponse } from "@/lib/platform/backup-only-cron";
import { processContentCaptureRemindersServer } from "@/lib/content-calendar/capture-reminders-server";

export const maxDuration = 120;

export async function GET(req: Request) {
  if (!verifyCronSecret(req)) return cronUnauthorized();
  const skipped = await backupOnlyCronSkipResponse("content-capture-reminders");
  if (skipped) return skipped;

  const result = await processContentCaptureRemindersServer();
  return NextResponse.json({ ok: true, ...result });
}
