/**
 * Shared helper for App Hosting cron routes: when Phase 4 heavy-job queue is on,
 * enqueue and return a JSON response instead of doing the work inline.
 */
import { NextResponse } from "next/server";
import { isQueueHeavyJobsV1Enabled } from "@/lib/queue/flags";

export async function maybeEnqueueHeavyCron(
  enqueue: () => Promise<string | null>,
  job: string,
): Promise<NextResponse | null> {
  if (!isQueueHeavyJobsV1Enabled()) return null;
  const jobId = await enqueue();
  if (!jobId) {
    return NextResponse.json(
      { ok: false, error: "Failed to enqueue (is REDIS_URL set?)", job },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, queued: true, job, jobId });
}
