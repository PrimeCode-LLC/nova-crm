import { NextResponse } from "next/server";
import { cronUnauthorized, verifyCronSecret } from "@/lib/scrapers/cron-auth";
import { processContentCaptureRemindersServer } from "@/lib/content-calendar/capture-reminders-server";

export const maxDuration = 120;

/**
 * Legacy / rollback path for P1.5.
 * Default: Cloud Functions `sendContentCaptureReminders` when
 * `CONTENT_CAPTURE_REMINDERS_RUNTIME=functions`.
 */
export async function GET(req: Request) {
  if (!verifyCronSecret(req)) return cronUnauthorized();

  const result = await processContentCaptureRemindersServer();
  return NextResponse.json({ ok: true, ...result });
}
