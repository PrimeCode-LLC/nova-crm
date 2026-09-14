import { NextResponse } from "next/server";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import {
  getConfigLineage,
  getOutreachConfig,
  getZonePointers,
} from "@/lib/ai/outreach-config-server";
import { getOutreachConfigScorecard } from "@/lib/ai/eval/scorecard-server";
import { listEvalRuns } from "@/lib/ai/eval/dataset-server";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import type { AiFeatureKey } from "@/lib/ai/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const g = await guardAdminFeature("outreach_lab");
  if (!g.ok) return g.response;

  const { id: configId } = await ctx.params;
  const orgId = g.ctx.session.organizationId;
  const config = await getOutreachConfig(orgId, configId);
  if (!config) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [scorecard, lineage, evalRuns, zonePointers, sampleGenerations] =
    await Promise.all([
      getOutreachConfigScorecard(orgId, configId),
      getConfigLineage(orgId, configId),
      listEvalRuns(orgId, configId),
      getZonePointers(orgId, config.featureKey as AiFeatureKey),
      withOrganizationScope(orgId, async (tx) =>
        tx.aiGeneration.findMany({
          where: { organizationId: orgId, configId },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: {
            id: true,
            zone: true,
            status: true,
            accepted: true,
            createdAt: true,
            output: true,
            userPrompt: true,
          },
        }),
      ),
    ]);

  const zones = (["lab", "canary", "default"] as const).filter(
    (z) => zonePointers[z] === configId,
  );

  return NextResponse.json({
    config,
    scorecard,
    lineage,
    evalRuns,
    zones,
    zonePointers,
    sampleGenerations,
  });
}
