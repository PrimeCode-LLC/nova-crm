import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { isQueueHeavyJobsV1Enabled, isScheduledEmailPgV1Enabled } from "@/lib/queue/flags";
import { enqueueScheduledEmailJob } from "@/lib/queue/enqueue";

/** Allow SMTP work to finish before platform kill when falling back inline. */
export const maxDuration = 60;

/**
 * Nudge the scheduled-email worker. When the queue is on this route is enqueue-only
 * (browser tabs must not run SMTP). Inline flush only when Redis/queue is unavailable.
 */
export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) {
    return g.response;
  }

  const forUser = new URL(req.url).searchParams.get("forUser")?.trim();
  const organizationId = g.ctx.session.organizationId;

  if (isQueueHeavyJobsV1Enabled() || isScheduledEmailPgV1Enabled()) {
    const jobId = await enqueueScheduledEmailJob().catch(() => null);
    return NextResponse.json({
      ok: true,
      queued: Boolean(jobId),
      jobId,
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      hint: "Worker tick enqueued; browser does not flush SMTP.",
    });
  }

  // Legacy local/dev without Redis: keep a thin inline path.
  const {
    processDueScheduledEmailsForMemberServer,
    processDueScheduledEmailsForOrgServer,
  } = await import("@/lib/email/scheduled-emails-server");
  const { resolveMailboxDataOwnerUid } = await import(
    "@/lib/email/mailbox-data-owner-server"
  );

  if (forUser && forUser !== "all") {
    const resolved = await resolveMailboxDataOwnerUid({
      organizationId,
      viewerUid: g.ctx.session.uid,
      viewerRole: g.ctx.role,
      forUserParam: forUser,
    });
    if (!resolved.ok) {
      return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
    }
    const memberRes = await processDueScheduledEmailsForMemberServer({
      organizationId,
      uid: resolved.dataOwnerUid,
    });
    return NextResponse.json({ ok: true, queued: false, ...memberRes });
  }

  const orgRes = await processDueScheduledEmailsForOrgServer({ organizationId });
  return NextResponse.json({ ok: true, queued: false, ...orgRes });
}
