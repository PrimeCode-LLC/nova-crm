import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  resolveMailboxDataOwnerUid,
  canMailboxView,
  mailboxReadOnlyForClient,
} from "@/lib/email/mailbox-data-owner-server";
import { getMailboxProfileServer } from "@/lib/email/mailbox-profiles-server";
import {
  addUtcDayKeys,
  getMailboxDayLoadsServer,
  utcSendDayKey,
} from "@/lib/email/mailbox-send-quota-server";

export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const mailboxId = url.searchParams.get("mailboxId")?.trim() ?? "";
  const forUser = url.searchParams.get("forUser");
  const horizonRaw = Number(url.searchParams.get("horizonDays") ?? 60);
  const horizonDays =
    Number.isFinite(horizonRaw) && horizonRaw > 0 ? Math.min(90, Math.floor(horizonRaw)) : 60;

  if (!mailboxId) {
    return NextResponse.json({ ok: false, error: "mailboxId is required" }, { status: 400 });
  }

  const resolved = await resolveMailboxDataOwnerUid({
    organizationId: g.ctx.session.organizationId,
    viewerUid: g.ctx.session.uid,
    viewerRole: g.ctx.role,
    forUserParam: forUser,
    mailboxId,
  });
  if (!resolved.ok) {
    return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
  }
  if (!canMailboxView(resolved)) {
    return NextResponse.json({ ok: false, error: "Mailbox not accessible." }, { status: 403 });
  }

  const profile = await getMailboxProfileServer({
    organizationId: g.ctx.session.organizationId,
    uid: resolved.dataOwnerUid,
    mailboxId,
  });
  if (!profile) {
    return NextResponse.json({ ok: false, error: "Mailbox not found." }, { status: 404 });
  }

  const fromDayKey = utcSendDayKey();
  const toDayKey = addUtcDayKeys(fromDayKey, horizonDays - 1);
  const loads = await getMailboxDayLoadsServer({
    organizationId: g.ctx.session.organizationId,
    uid: resolved.dataOwnerUid,
    mailboxId,
    dailySendLimit: profile.dailySendLimit,
    fromDayKey,
    toDayKey,
  });

  return NextResponse.json({
    ok: true,
    mailboxId,
    limit: loads.limit,
    fromDayKey: loads.fromDayKey,
    toDayKey: loads.toDayKey,
    byDay: loads.byDay,
    mailboxReadOnly: mailboxReadOnlyForClient(resolved),
  });
}
