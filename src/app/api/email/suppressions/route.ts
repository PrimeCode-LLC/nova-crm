import { z } from "zod";
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

const suppressionBodySchema = z.object({
  email: z.string().trim().email().max(320),
  reason: z.enum(["unsubscribe", "hard_bounce", "complaint", "manual"]).optional(),
  leadId: z.string().trim().min(1).max(128).optional(),
});

export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  // Validate shape first: a non-string email used to crash with a 500 (QA 2.8 / ROB-06).
  const parsed = suppressionBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Provide a valid email and an optional reason (unsubscribe, hard_bounce, complaint, manual)." },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const email = body.email;
  const reason: SuppressionReason = body.reason ?? "manual";
  const result = await addSuppression({
    organizationId: g.ctx.session.organizationId,
    email,
    reason,
    source: "manual",
    leadId: body.leadId,
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
