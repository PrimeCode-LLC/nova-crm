import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { resolveMailboxDataOwnerUid, canMailboxSend } from "@/lib/email/mailbox-data-owner-server";
import {
  cancelScheduledEmailServer,
  retryScheduledEmailServer,
} from "@/lib/email/scheduled-emails-server";

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
  const reason = new URL(req.url).searchParams.get("reason")?.trim() || undefined;
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
      { ok: false, error: "You cannot cancel scheduled mail for another member's mailbox." },
      { status: 403 },
    );
  }

  const result = await cancelScheduledEmailServer({
    organizationId: g.ctx.session.organizationId,
    uid: resolved.dataOwnerUid,
    id: scheduledId,
    reason,
  });

  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

/** Re-queue a failed scheduled email for send (~1 minute from now). */
export async function POST(req: Request, context: RouteContext) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const { id } = await context.params;
  const scheduledId = id?.trim();
  if (!scheduledId) {
    return NextResponse.json({ ok: false, error: "Missing scheduled email id." }, { status: 400 });
  }

  let body: { action?: string } = {};
  try {
    body = (await req.json()) as { action?: string };
  } catch {
    body = {};
  }
  if ((body.action ?? "retry") !== "retry") {
    return NextResponse.json({ ok: false, error: "Unsupported action." }, { status: 400 });
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
  if (!canMailboxSend(resolved)) {
    return NextResponse.json(
      { ok: false, error: "You cannot retry scheduled mail for another member's mailbox." },
      { status: 403 },
    );
  }

  const result = await retryScheduledEmailServer({
    organizationId: g.ctx.session.organizationId,
    uid: resolved.dataOwnerUid,
    id: scheduledId,
  });

  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, scheduledAt: result.scheduledAt });
}
