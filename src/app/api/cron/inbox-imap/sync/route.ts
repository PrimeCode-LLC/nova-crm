import { NextResponse } from "next/server";
import { cronUnauthorized, verifyCronSecret } from "@/lib/scrapers/cron-auth";
import { backupOnlyCronSkipResponse } from "@/lib/platform/backup-only-cron";
import { runInboxImapSyncCronServer } from "@/lib/email/inbox-imap-sync-cron-server";

export const maxDuration = 300;

/**
 * Server-side IMAP inbox head sync (badge / list hydrate without open browser tabs).
 * Respects per-mailbox `syncIntervalMinutes` + `inboxLastSyncedAt`.
 */
export async function GET(req: Request) {
  if (!verifyCronSecret(req)) return cronUnauthorized();
  const skipped = await backupOnlyCronSkipResponse("inbox-imap/sync");
  if (skipped) return skipped;

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
