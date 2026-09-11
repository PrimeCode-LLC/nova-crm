import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  addSuppression,
  listSuppressions,
  removeSuppression,
  type SuppressionReason,
} from "@/lib/email/suppression-server";

export async function GET() {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const items = await listSuppressions({
    organizationId: g.ctx.session.organizationId,
  });
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => null)) as {
    email?: string;
    reason?: SuppressionReason;
    leadId?: string;
  } | null;
  const email = body?.email?.trim() ?? "";
  const reason = body?.reason ?? "manual";
  if (!email) {
    return NextResponse.json({ ok: false, error: "email required" }, { status: 400 });
  }
  if (!["unsubscribe", "hard_bounce", "complaint", "manual"].includes(reason)) {
    return NextResponse.json({ ok: false, error: "invalid reason" }, { status: 400 });
  }
  const result = await addSuppression({
    organizationId: g.ctx.session.organizationId,
    email,
    reason,
    source: "manual",
    leadId: body?.leadId,
    createdBy: g.ctx.session.uid,
  });
  if (!("ok" in result) || !result.ok) {
    return NextResponse.json(
      { ok: false, error: "error" in result ? result.error : "failed" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, id: result.id, created: result.created });
}

export async function DELETE(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const email =
    new URL(req.url).searchParams.get("email")?.trim() ||
    ((await req.json().catch(() => null)) as { email?: string } | null)?.email?.trim() ||
    "";
  if (!email) {
    return NextResponse.json({ ok: false, error: "email required" }, { status: 400 });
  }
  const result = await removeSuppression({
    organizationId: g.ctx.session.organizationId,
    email,
  });
  if (!("ok" in result) || !result.ok) {
    return NextResponse.json(
      { ok: false, error: "error" in result ? result.error : "failed" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, removed: result.removed });
}
