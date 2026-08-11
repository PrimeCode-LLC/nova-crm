import { NextResponse } from "next/server";
import { cronUnauthorized, verifyCronSecret } from "@/lib/scrapers/cron-auth";
import { runInboxImapSyncCronServer } from "@/lib/email/inbox-imap-sync-cron-server";
import { enqueueImapSyncJob } from "@/lib/queue/enqueue";
import { maybeEnqueueHeavyCron } from "@/lib/queue/cron-enqueue";

export const maxDuration = 300;

/**
 * Legacy / rollback path: full IMAP inbox head sync on App Hosting.
 *
 * Production (P1.2+) runs heads on Cloud Functions (`syncInboxImapHeads`) and only
 * calls `/api/cron/inbox-imap/postprocess` here. Set Functions param
 * `IMAP_SYNC_RUNTIME=apphosting` to restore this route as the scheduled target.
 *
 * P4.4: when `QUEUE_HEAVY_JOBS_V1` is on, enqueues BullMQ and returns.
 *
 * Respects per-mailbox `syncIntervalMinutes` + `inboxLastSyncedAt`.
 */
export async function GET(req: Request) {
  if (!verifyCronSecret(req)) return cronUnauthorized();

  const queued = await maybeEnqueueHeavyCron(enqueueImapSyncJob, "imap-sync");
  if (queued) return queued;

  const started = Date.now();
  try {
    const result = await runInboxImapSyncCronServer();
    console.log(
      JSON.stringify({
        level: "info",
        msg: "inbox-imap cron completed",
        ...result,
        ms: Date.now() - started,
      }),
    );
    return NextResponse.json({ ok: true, ...result, ms: Date.now() - started });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(
      JSON.stringify({
        level: "error",
        msg: "inbox-imap cron failed",
        error,
        ms: Date.now() - started,
      }),
    );
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
