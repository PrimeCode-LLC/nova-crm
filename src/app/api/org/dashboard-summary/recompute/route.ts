/**
 * Admin backfill / repair for org dashboard summary (P3.4: Postgres SoT).
 * Live updates: CRM dual-write schedule + CF → App Hosting recompute-org.
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
    store: "postgres",
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
