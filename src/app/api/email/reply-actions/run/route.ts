import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { runReplyIntelligenceForLeadServer } from "@/lib/email/run-reply-intelligence-server";

const bodySchema = z.object({
  leadId: z.string().min(1).max(120),
});

export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await runReplyIntelligenceForLeadServer({
    organizationId: g.ctx.session.organizationId,
    leadId: parsed.data.leadId,
    actorUid: g.ctx.session.uid,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, code: result.code },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    actionId: result.actionId,
    providerKey: result.providerKey,
    nextAction: result.nextAction,
    replyClass: result.replyClass,
    mode: result.mode,
    targetLeadId: result.targetLeadId,
  });
}
