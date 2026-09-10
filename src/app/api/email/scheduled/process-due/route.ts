import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { resolveMailboxDataOwnerUid } from "@/lib/email/mailbox-data-owner-server";
import { withDevProcessDueLock } from "@/lib/email/dev-process-due-lock";
import {
  processDueScheduledEmailsForMemberServer,
  processDueScheduledEmailsForOrgServer,
} from "@/lib/email/scheduled-emails-server";
import { isQueueHeavyJobsV1Enabled } from "@/lib/queue/flags";
import { enqueueScheduledEmailJob } from "@/lib/queue/enqueue";

/** Allow SMTP work to finish before platform kill; internal budget is 20s. */
export const maxDuration = 60;

/**
 * Flush due scheduled emails for the organization or a specific mailbox owner.
 *
 * Runs a member-scoped send when `forUser` is given (with org fallback if none found under that uid).
 * When `forUser` is omitted, flushes due emails organization-wide across all member roots.
 * When the heavy-job queue is on, also enqueues a global worker tick.
 */
export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) {
    console.warn("[process-due-route] Unauthorized or tenant guard rejected request");
    return g.response;
  }

  const forUser = new URL(req.url).searchParams.get("forUser")?.trim();
  const organizationId = g.ctx.session.organizationId;

  console.log(`[process-due-route] POST received for org: "${organizationId}", viewerUid: "${g.ctx.session.uid}", forUser: "${forUser || "(all/none)"}"`);

  let jobId: string | null = null;
  if (isQueueHeavyJobsV1Enabled()) {
    jobId = await enqueueScheduledEmailJob().catch(() => null);
  }

  // If a specific member is requested, flush that member with fallback to org flush
  if (forUser && forUser !== "all") {
    const resolved = await resolveMailboxDataOwnerUid({
      organizationId,
      viewerUid: g.ctx.session.uid,
      viewerRole: g.ctx.role,
      forUserParam: forUser,
    });
    if (!resolved.ok) {
      console.warn(`[process-due-route] resolveMailboxDataOwnerUid failed for forUser="${forUser}":`, resolved.error);
      return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
    }

    console.log(`[process-due-route] Member flush requested for dataOwnerUid="${resolved.dataOwnerUid}" (viewerUid="${g.ctx.session.uid}", org="${organizationId}")`);

    const lockKey = `${organizationId}/${resolved.dataOwnerUid}`;
    const locked = await withDevProcessDueLock(lockKey, async () => {
      const memberRes = await processDueScheduledEmailsForMemberServer({
        organizationId,
        uid: resolved.dataOwnerUid,
      });

      console.log(`[process-due-route] Member flush finished for "${resolved.dataOwnerUid}": dueFound=${memberRes.dueFound}, sent=${memberRes.sent}, pendingCount=${memberRes.pendingCount}`);
      return memberRes;
    });

    if (!locked.ok) {
      console.log(`[process-due-route] Member flush lock busy for key "${lockKey}"`);
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

    console.log(`[process-due-route] Returning member flush response: sent=${locked.result.sent}, dueFound=${locked.result.dueFound}`);
    return NextResponse.json({
      ok: true,
      queued: Boolean(jobId),
      jobId,
      ...locked.result,
    });
  }

  // When no specific member is requested: flush organization-wide due emails across all member roots
  const orgLockKey = `${organizationId}/__org_due__`;
  console.log(`[process-due-route] Executing org-wide flush for org "${organizationId}" with lock "${orgLockKey}"`);
  const locked = await withDevProcessDueLock(orgLockKey, () =>
    processDueScheduledEmailsForOrgServer({ organizationId }),
  );

  if (!locked.ok) {
    console.log(`[process-due-route] Org-wide lock busy for key "${orgLockKey}"`);
    return NextResponse.json({
      ok: true,
      busy: true,
      queued: Boolean(jobId),
      jobId,
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      hint: "Another organization-wide process-due flush is in flight.",
    });
  }

  console.log(`[process-due-route] Returning org-wide flush response: sent=${locked.result.sent}, dueFound=${locked.result.dueFound}, pendingCount=${locked.result.pendingCount}`);
  return NextResponse.json({
    ok: true,
    queued: Boolean(jobId),
    jobId,
    ...locked.result,
  });
}
