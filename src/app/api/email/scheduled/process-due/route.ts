import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { resolveMailboxDataOwnerUid, canMailboxSend } from "@/lib/email/mailbox-data-owner-server";
import { withDevProcessDueLock } from "@/lib/email/dev-process-due-lock";
import { processDueScheduledEmailsForMemberServer } from "@/lib/email/scheduled-emails-server";

/**
 * Local/dev helper: send due scheduled emails for the current mailbox owner.
 * Production continues to use `/api/cron/scheduled-emails/send` only.
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "Use the scheduled-emails cron in production." },
      { status: 404 },
    );
  }

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

  const lockKey = `${g.ctx.session.organizationId}/${resolved.dataOwnerUid}`;
  const locked = await withDevProcessDueLock(lockKey, () =>
    processDueScheduledEmailsForMemberServer({
      organizationId: g.ctx.session.organizationId,
      uid: resolved.dataOwnerUid,
    }),
  );

  if (!locked.ok) {
    return NextResponse.json({
      ok: true,
      busy: true,
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
    });
  }

  return NextResponse.json({ ok: true, ...locked.result });
}
