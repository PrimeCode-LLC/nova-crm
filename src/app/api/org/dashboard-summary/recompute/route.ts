/**
 * Admin backfill / repair for full org dashboard summary (P0.4–P0.10).
 * Live updates come from Cloud Functions on lead/deal/followup writes.
 */
import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { recomputeOrgDashboardSummaryServer } from "@/lib/dashboard-summary-server";

export async function POST() {
  const g = await guardTenantApi({ minRole: "admin" });
  if (!g.ok) return g.response;

  const orgId = g.ctx.session.organizationId;
  const result = await recomputeOrgDashboardSummaryServer(orgId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  const s = result.summary;
  return NextResponse.json({
    ok: true,
    openSalesLeads: s.openSalesLeads,
    idleSalesLeads: s.idleSalesLeads,
    prospects: s.prospects,
    followupsDue: s.followupsDue,
    totalReplies: s.totalReplies,
    openPipelineValue: s.openPipelineValue,
    openDealCount: s.openDealCount,
    leadEstimateContributors: s.leadEstimateContributors,
    pipelineByStage: s.pipelineByStage,
    channelMix: s.channelMix,
    funnelByChannel: s.funnelByChannel,
    ranges: s.ranges,
    updatedAt: s.updatedAt,
  });
}
