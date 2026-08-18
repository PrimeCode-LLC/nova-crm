/**
 * Postgres `org_dashboard_summaries` ↔ domain `OrgDashboardSummary` (P3.1).
 * Writers/readers land in P3.2 / P3.3; this keeps column ↔ field mapping in one place.
 */

import type { OrgDashboardSummary as OrgDashboardSummaryRow } from "@/generated/prisma/client";
import {
  ORG_DASHBOARD_SUMMARY_VERSION,
  emptyOrgDashboardSummary,
  parseOrgDashboardSummary,
  type OrgDashboardSummary,
} from "@/lib/dashboard-summary";

export type OrgDashboardSummaryUpsertInput = {
  organizationId: string;
  summary: OrgDashboardSummary;
};

/** Build a typed domain summary from a Prisma row (null if JSON shape is invalid). */
export function orgDashboardSummaryFromRow(
  row: OrgDashboardSummaryRow,
): OrgDashboardSummary | null {
  return parseOrgDashboardSummary({
    id: row.organizationId,
    organizationId: row.organizationId,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    openSalesLeads: row.openSalesLeads,
    idleSalesLeads: row.idleSalesLeads,
    prospects: row.prospects,
    prospectsNeedRouting: row.prospectsNeedRouting,
    prospectsReadyToPush: row.prospectsReadyToPush,
    prospectsPushed: row.prospectsPushed,
    followupsDue: row.followupsDue,
    overdueFollowups: row.overdueFollowups,
    totalReplies: row.totalReplies,
    repliesPendingReview: row.repliesPendingReview,
    openPipelineValue: row.openPipelineValue,
    openDealCount: row.openDealCount,
    leadEstimateContributors: row.leadEstimateContributors,
    pipelineByStage: row.pipelineByStage,
    channelMix: row.channelMix,
    funnelByChannel: row.funnelByChannel,
    ranges: row.ranges,
  });
}

/** Prisma create/update data from a domain summary (version must match current schema). */
export function orgDashboardSummaryToRowData(summary: OrgDashboardSummary) {
  if (summary.version !== ORG_DASHBOARD_SUMMARY_VERSION) {
    throw new Error(
      `Unsupported org dashboard summary version ${summary.version}; expected ${ORG_DASHBOARD_SUMMARY_VERSION}`,
    );
  }
  if (summary.id !== summary.organizationId) {
    throw new Error("Org dashboard summary id must equal organizationId");
  }

  return {
    organizationId: summary.organizationId,
    version: summary.version,
    updatedAt: new Date(summary.updatedAt),
    openSalesLeads: summary.openSalesLeads,
    idleSalesLeads: summary.idleSalesLeads,
    prospects: summary.prospects,
    prospectsNeedRouting: summary.prospectsNeedRouting,
    prospectsReadyToPush: summary.prospectsReadyToPush,
    prospectsPushed: summary.prospectsPushed,
    followupsDue: summary.followupsDue,
    overdueFollowups: summary.overdueFollowups,
    totalReplies: summary.totalReplies,
    repliesPendingReview: summary.repliesPendingReview,
    openPipelineValue: summary.openPipelineValue,
    openDealCount: summary.openDealCount,
    leadEstimateContributors: summary.leadEstimateContributors,
    pipelineByStage: summary.pipelineByStage,
    channelMix: summary.channelMix,
    funnelByChannel: summary.funnelByChannel,
    ranges: summary.ranges,
  };
}

/** Zeroed row payload for seeding before first recompute. */
export function emptyOrgDashboardSummaryRowData(
  organizationId: string,
  updatedAt: Date = new Date(),
) {
  return orgDashboardSummaryToRowData(
    emptyOrgDashboardSummary(organizationId, updatedAt.toISOString()),
  );
}
