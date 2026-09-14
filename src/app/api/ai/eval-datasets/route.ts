import { NextResponse } from "next/server";
import { guardAdminFeature, guardPermissionAction } from "@/lib/platform/guard-admin-feature";
import { listEvalDatasetItems, seedGoldenDataset } from "@/lib/ai/eval/dataset-server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const g = await guardAdminFeature("outreach_lab");
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const datasetKey = url.searchParams.get("datasetKey") ?? "golden_v1";
  const items = await listEvalDatasetItems(g.ctx.session.organizationId, datasetKey);
  return NextResponse.json({ items, datasetKey, count: items.length });
}

export async function POST() {
  const g = await guardPermissionAction("outreach_lab.run_eval", {
    orAdminFeature: "outreach_lab",
  });
  if (!g.ok) return g.response;

  const result = await seedGoldenDataset(g.ctx.session.organizationId);
  return NextResponse.json(result);
}
