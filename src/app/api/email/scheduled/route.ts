import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { resolveMailboxDataOwnerUid, canMailboxSend, mailboxReadOnlyForClient } from "@/lib/email/mailbox-data-owner-server";
import {
  createScheduledEmailServer,
  listScheduledEmailsForMemberServer,
} from "@/lib/email/scheduled-emails-server";
import { getMailboxProfileServer } from "@/lib/email/mailbox-profiles-server";
import { assertMailboxScheduleDayQuotaServer } from "@/lib/email/mailbox-send-quota-server";
import { normalizeMessageId } from "@/lib/email/thread-inbound";
import { assertLeadContactAllowedServer } from "@/lib/email/lead-contact-policy-server";

export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const forUser = url.searchParams.get("forUser");
  const statusParam = url.searchParams.get("status")?.trim();
  const status =
    statusParam === "pending" || statusParam === "done" ? statusParam : undefined;

  const resolved = await resolveMailboxDataOwnerUid({
    organizationId: g.ctx.session.organizationId,
    viewerUid: g.ctx.session.uid,
    viewerRole: g.ctx.role,
    forUserParam: forUser,
  });
  if (!resolved.ok) {
    return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
  }

  const items = await listScheduledEmailsForMemberServer({
    organizationId: g.ctx.session.organizationId,
    uid: resolved.dataOwnerUid,
    status,
  });

  return NextResponse.json({ ok: true, items, mailboxReadOnly: mailboxReadOnlyForClient(resolved) });
}

export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const forUser = new URL(req.url).searchParams.get("forUser");

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const to = String(body.to ?? "").trim();
  const scheduledAt = String(body.scheduledAt ?? "").trim();
  const mailboxId = String(body.mailboxId ?? "").trim();
  const from = String(body.from ?? "").trim();
  const text = String(body.text ?? "");
  const html = String(body.html ?? text.split("\n").map((l) => `<p>${l || "<br/>"}</p>`).join(""));

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
  if (!canMailboxSend(resolved)) {
    return NextResponse.json(
      {
        ok: false,
        error: "You can view this mailbox but cannot schedule mail on behalf of another member.",
      },
      { status: 403 },
    );
  }

  if (!to || !scheduledAt || !mailboxId || !from) {
    return NextResponse.json(
      { ok: false, error: "Recipient, schedule time, mailbox, and from address are required." },
      { status: 400 },
    );
  }
  const leadId = String(body.leadId ?? "").trim() || undefined;
  const contactPolicy = await assertLeadContactAllowedServer({
    organizationId: g.ctx.session.organizationId,
    leadId,
  });
  if (!contactPolicy.ok) {
    return NextResponse.json(
      { ok: false, error: contactPolicy.error },
      { status: contactPolicy.status },
    );
  }

  const profile = await getMailboxProfileServer({
    organizationId: g.ctx.session.organizationId,
    uid: resolved.dataOwnerUid,
    mailboxId,
  });
  const scheduleQuota = await assertMailboxScheduleDayQuotaServer({
    organizationId: g.ctx.session.organizationId,
    uid: resolved.dataOwnerUid,
    mailboxId,
    dailySendLimit: profile?.dailySendLimit ?? null,
    scheduledAt,
  });
  if (!scheduleQuota.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: scheduleQuota.error,
        dayKey: scheduleQuota.dayKey,
        used: scheduleQuota.used,
        limit: scheduleQuota.limit,
        remaining: scheduleQuota.remaining,
      },
      { status: scheduleQuota.status },
    );
  }

  const result = await createScheduledEmailServer({
    organizationId: g.ctx.session.organizationId,
    uid: resolved.dataOwnerUid,
    mailboxId,
    from,
    displayName: String(body.displayName ?? "").trim() || undefined,
    replyTo: String(body.replyTo ?? "").trim() || undefined,
    to,
    cc: String(body.cc ?? "").trim() || undefined,
    subject: String(body.subject ?? "").trim(),
    text,
    html,
    attachments: body.attachments,
    scheduledAt,
    scheduledByUserId: g.ctx.session.uid,
    followupId: String(body.followupId ?? "").trim() || undefined,
    leadId,
    inReplyTo: normalizeMessageId(String(body.inReplyTo ?? "")),
    referenceIds: Array.isArray(body.referenceIds)
      ? body.referenceIds
          .map((value) => normalizeMessageId(String(value ?? "")))
          .filter((value): value is string => Boolean(value))
          .slice(-50)
      : undefined,
  });

  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: result.id });
}
