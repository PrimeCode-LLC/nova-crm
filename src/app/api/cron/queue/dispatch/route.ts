/**
 * P4.4 — thin cron dispatcher: enqueue heavy jobs onto BullMQ and return.
 * Cloud Functions / AH schedulers call this when `QUEUE_HEAVY_JOBS_V1=true`
 * so the worker tier owns the work.
 */
import { NextResponse } from "next/server";
import { cronUnauthorized, verifyCronSecret } from "@/lib/scrapers/cron-auth";
import { isQueueHeavyJobsV1Enabled } from "@/lib/queue/flags";
import {
  enqueueContentRemindersJob,
  enqueueDashboardSummaryJob,
  enqueueImapSyncJob,
  enqueueScheduledEmailJob,
  enqueueScrapersJob,
} from "@/lib/queue/enqueue";

export const maxDuration = 30;

const JOBS = {
  "imap-sync": enqueueImapSyncJob,
  "scheduled-email": enqueueScheduledEmailJob,
  scrapers: () => enqueueScrapersJob({ mode: "due" }),
  "content-reminders": enqueueContentRemindersJob,
  "dashboard-summary": () => enqueueDashboardSummaryJob({ mode: "dirty" }),
} as const;

type JobKey = keyof typeof JOBS;

export async function POST(req: Request) {
  if (!verifyCronSecret(req)) return cronUnauthorized();

  if (!isQueueHeavyJobsV1Enabled()) {
    return NextResponse.json(
      {
        ok: false,
        error: "QUEUE_HEAVY_JOBS_V1 (and QUEUE_WORKER_V1) must be true",
      },
      { status: 409 },
    );
  }

  let body: { job?: string } = {};
  try {
    body = (await req.json()) as { job?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const job = body.job as JobKey | undefined;
  if (!job || !(job in JOBS)) {
    return NextResponse.json(
      { ok: false, error: `Unknown job. Expected one of: ${Object.keys(JOBS).join(", ")}` },
      { status: 400 },
    );
  }

  const jobId = await JOBS[job]();
  if (!jobId) {
    return NextResponse.json(
      { ok: false, error: "Failed to enqueue (is REDIS_URL set?)" },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, job, jobId, queued: true });
}
