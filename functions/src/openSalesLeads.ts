/**
 * Keep in sync with `src/lib/dashboard-summary.ts` lead gauge helpers (P0.4 / P0.7).
 * Functions package cannot import the Next app `@/` tree.
 */

export type OpenSalesLeadFields = {
  intakeKind?: string | null;
  stage?: string | null;
  isIdle?: boolean | null;
};

export function leadCountsTowardOpenSalesLeads(lead: OpenSalesLeadFields | null | undefined): boolean {
  if (!lead) return false;
  if (lead.intakeKind === "prospect") return false;
  const stage = typeof lead.stage === "string" ? lead.stage : "";
  return stage !== "won" && stage !== "lost";
}

export function leadCountsTowardIdleSalesLeads(lead: OpenSalesLeadFields | null | undefined): boolean {
  return leadCountsTowardOpenSalesLeads(lead) && Boolean(lead?.isIdle);
}

export function openSalesLeadsContributionDelta(
  before: OpenSalesLeadFields | null | undefined,
  after: OpenSalesLeadFields | null | undefined,
): number {
  const was = leadCountsTowardOpenSalesLeads(before) ? 1 : 0;
  const now = leadCountsTowardOpenSalesLeads(after) ? 1 : 0;
  return now - was;
}

export function idleSalesLeadsContributionDelta(
  before: OpenSalesLeadFields | null | undefined,
  after: OpenSalesLeadFields | null | undefined,
): number {
  const was = leadCountsTowardIdleSalesLeads(before) ? 1 : 0;
  const now = leadCountsTowardIdleSalesLeads(after) ? 1 : 0;
  return now - was;
}

export const ORG_DASHBOARD_SUMMARIES = "orgDashboardSummaries";
export const ORG_DASHBOARD_SUMMARY_VERSION = 1 as const;

export function emptyOrgDashboardSummary(
  organizationId: string,
  updatedAt: string,
  gauges?: { openSalesLeads?: number; idleSalesLeads?: number },
): Record<string, unknown> {
  return {
    id: organizationId,
    organizationId,
    version: ORG_DASHBOARD_SUMMARY_VERSION,
    updatedAt,
    openSalesLeads: Math.max(0, gauges?.openSalesLeads ?? 0),
    idleSalesLeads: Math.max(0, gauges?.idleSalesLeads ?? 0),
    prospects: 0,
    prospectsNeedRouting: 0,
    prospectsReadyToPush: 0,
    prospectsPushed: 0,
    followupsDue: 0,
    overdueFollowups: 0,
    totalReplies: 0,
    repliesPendingReview: 0,
    openPipelineValue: 0,
    openDealCount: 0,
    leadEstimateContributors: 0,
    pipelineByStage: {},
    channelMix: {},
    funnelByChannel: {},
    ranges: {},
  };
}
