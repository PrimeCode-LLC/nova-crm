import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { resolveMailboxDataOwnerUid } from "@/lib/email/mailbox-data-owner-server";
import { applyEmailBounceServer } from "@/lib/email/apply-email-bounce-server";
import type { BounceKind } from "@/lib/email/detect-hard-bounce";

export async function POST(req: Request) {
  try {
    const g = await guardTenantApi();
    if (!g.ok) return g.response;

    let b: Record<string, unknown>;
    try {
      b = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const mailboxId = String(b.mailboxId ?? "").trim();
    const inboundMessageId = String(b.inboundMessageId ?? "").trim();
    const bounceKindRaw = String(b.bounceKind ?? "hard").trim().toLowerCase();
    const bounceKind: BounceKind = bounceKindRaw === "soft" ? "soft" : "hard";
    const failedRecipients = Array.isArray(b.failedRecipients)
      ? b.failedRecipients.map((e) => String(e).trim().toLowerCase()).filter(Boolean)
      : [];
    const originalMessageId = String(b.originalMessageId ?? "").trim() || undefined;
    const reason = String(b.reason ?? "").trim() || undefined;
    const subject = String(b.subject ?? "").trim() || undefined;
    const leadIdHint = String(b.leadIdHint ?? "").trim() || undefined;

    if (!mailboxId || !inboundMessageId) {
      return NextResponse.json(
        { ok: false, error: "mailboxId and inboundMessageId are required" },
        { status: 400 },
      );
    }

    const forUser = new URL(req.url).searchParams.get("forUser");
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

    const result = await applyEmailBounceServer({
      organizationId: g.ctx.session.organizationId,
      actorUid: g.ctx.session.uid,
      dataOwnerUid: resolved.dataOwnerUid,
      mailboxId,
      inboundMessageId,
      bounceKind,
      failedRecipients,
      originalMessageId,
      reason,
      subject,
      leadIdHint,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status ?? 400 },
      );
    }

    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
