import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { resolveMailboxDataOwnerUid } from "@/lib/email/mailbox-data-owner-server";
import { cancelScheduledEmailServer } from "@/lib/email/scheduled-emails-server";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, context: RouteContext) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const { id } = await context.params;
  const scheduledId = id?.trim();
  if (!scheduledId) {
    return NextResponse.json({ ok: false, error: "Missing scheduled email id." }, { status: 400 });
  }

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
  if (!resolved.viewerIsMailboxOwner) {
    return NextResponse.json(
      { ok: false, error: "You cannot cancel scheduled mail for another member's mailbox." },
      { status: 403 },
    );
  }

  const result = await cancelScheduledEmailServer({
    organizationId: g.ctx.session.organizationId,
    uid: resolved.dataOwnerUid,
    id: scheduledId,
  });

  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
