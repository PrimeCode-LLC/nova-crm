import { NextResponse } from "next/server";
import { cronUnauthorized, verifyCronSecret } from "@/lib/scrapers/cron-auth";
import { processContentCaptureRemindersServer } from "@/lib/content-calendar/capture-reminders-server";
import { enqueueContentRemindersJob } from "@/lib/queue/enqueue";
import { maybeEnqueueHeavyCron } from "@/lib/queue/cron-enqueue";

export const maxDuration = 120;

/**
 * Legacy / rollback path for P1.5.
 * Default: Cloud Functions `sendContentCaptureReminders` when
 * `CONTENT_CAPTURE_REMINDERS_RUNTIME=functions`.
 *
 * P4.4: when `QUEUE_HEAVY_JOBS_V1` is on, enqueues BullMQ and returns.
 */
export async function GET(req: Request) {
  if (!verifyCronSecret(req)) return cronUnauthorized();

  const queued = await maybeEnqueueHeavyCron(
    enqueueContentRemindersJob,
    "content-reminders",
  );
  if (queued) return queued;

  const result = await processContentCaptureRemindersServer();
  return NextResponse.json({ ok: true, ...result });
}
