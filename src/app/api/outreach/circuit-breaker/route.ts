import { NextResponse } from "next/server";
import { guardPermissionAction } from "@/lib/platform/guard-admin-feature";
import { clearCircuitBreaker, getCircuitBreakerState } from "@/lib/email/outreach-circuit-breaker-server";

export const runtime = "nodejs";

export async function GET() {
  const g = await guardPermissionAction("outreach_lab.review_queue", {
    orAdminFeature: "outreach_lab",
  });
  if (!g.ok) return g.response;
  const state = await getCircuitBreakerState(g.ctx.session.organizationId);
  return NextResponse.json({ state });
}

export async function POST() {
  const g = await guardPermissionAction("outreach_lab.clear_circuit_breaker", {
    orAdminFeature: "outreach_lab",
  });
  if (!g.ok) return g.response;
  const result = await clearCircuitBreaker({
    organizationId: g.ctx.session.organizationId,
    clearedBy: g.ctx.session.uid,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true });
}
