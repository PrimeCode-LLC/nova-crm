import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { resolveMailboxDataOwnerUid, canMailboxSend } from "@/lib/email/mailbox-data-owner-server";
import { withDevProcessDueLock } from "@/lib/email/dev-process-due-lock";
import { processDueScheduledEmailsForMemberServer } from "@/lib/email/scheduled-emails-server";
import { isQueueHeavyJobsV1Enabled } from "@/lib/queue/flags";
import { enqueueScheduledEmailJob } from "@/lib/queue/enqueue";

/**
 * Flush due scheduled emails for the current mailbox owner.
 *
 * Always runs a small member-scoped send (limit 8, requeue gaps — no long sleeps).
 * When the heavy-job queue is on, also enqueues a global worker tick.
 */
export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const forUser = new URL(req.url).searchParams.get("forUser");
  const resolved = await resolveMailboxDataOwnerUid({
    organizationId: g.ctx.session.organizationId,
    viewerUid: g.ctx.session.uid,
    viewerRole: g.ctx.role,
    forUserParam: forUser,
  });
  if (!resolved.ok) {
    return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
  }
  if (!canMailboxSend(resolved)) {
    return NextResponse.json(
      { ok: false, error: "You cannot send scheduled mail for another member's mailbox." },
      { status: 403 },
    );
  }

  let jobId: string | null = null;
  if (isQueueHeavyJobsV1Enabled()) {
    jobId = await enqueueScheduledEmailJob().catch(() => null);
  }

  const lockKey = `${g.ctx.session.organizationId}/${resolved.dataOwnerUid}`;
  const locked = await withDevProcessDueLock(lockKey, () =>
    processDueScheduledEmailsForMemberServer({
      organizationId: g.ctx.session.organizationId,
      uid: resolved.dataOwnerUid,
    }),
  );

  if (!locked.ok) {
    // Do not invent dueFound: 0 — that hid production failures behind empty toasts.
    return NextResponse.json({
      ok: true,
      busy: true,
      queued: Boolean(jobId),
      jobId,
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      hint: "Another process-due flush is in flight for this mailbox owner.",
    });
  }

  return NextResponse.json({
    ok: true,
    queued: Boolean(jobId),
    jobId,
    ...locked.result,
  });
}
