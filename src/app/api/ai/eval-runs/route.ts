import { NextResponse } from "next/server";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import { getEvalRunDetail, listEvalRuns } from "@/lib/ai/eval/dataset-server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const g = await guardAdminFeature("outreach_lab");
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const configId = url.searchParams.get("configId") ?? undefined;
  const evalRunId = url.searchParams.get("id") ?? undefined;
  const orgId = g.ctx.session.organizationId;

  if (evalRunId) {
    const detail = await getEvalRunDetail(orgId, evalRunId);
    if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(detail);
  }

  const runs = await listEvalRuns(orgId, configId);
  return NextResponse.json({ runs });
}
