/**
 * Org-level precomputed dashboard KPI summary (Phase 0 / P0.3).
 *
 * Firestore: `orgDashboardSummaries/{organizationId}` (doc id === organizationId).
 * Redis cache key: {@link orgDashboardSummaryCacheKey} (TTL ~60s via cache helper).
 *
 * Does **not** extend `activityCounters` — that collection is per user/channel/day
 * manual rollups and is retired from the classic dashboard path.
 *
 * Scope: org-wide gauges + fixed range windows. Channel/owner-scoped variants
 * are deferred (see KPI inventory). Person-scoped fields (myOpenTasks) stay
 * out of this document.
 */

import { z } from "zod";

/** Bump when the persisted shape changes incompatibly. */
export const ORG_DASHBOARD_SUMMARY_VERSION = 1 as const;

/**
 * Precomputed windows for default dashboard time ranges.
 * Keys match common `DashboardTimeRangeKey` values used on Overview.
 */
export const ORG_DASHBOARD_SUMMARY_RANGE_KEYS = ["today", "7d", "30d", "all"] as const;

export type OrgDashboardSummaryRangeKey = (typeof ORG_DASHBOARD_SUMMARY_RANGE_KEYS)[number];

/** Range-scoped totals (emails / replies / closed revenue). */
export type OrgDashboardSummaryRangeMetrics = {
  sent: number;
  replies: number;
  opens: number;
  bounced: number;
  closedRevenue: number;
  wonDealCount: number;
};

/**
 * Point-in-time + range-window KPI payload for one organization.
 * Field names align with `DashboardWorkflowMetrics` / pipeline helpers where possible.
 */
export type OrgDashboardSummary = {
  /** Document id; always equal to `organizationId`. */
  id: string;
  organizationId: string;
  version: typeof ORG_DASHBOARD_SUMMARY_VERSION;
  /** Last successful writer update (ISO). */
  updatedAt: string;
  /** Open non-prospect leads (not won/lost). */
  openSalesLeads: number;
  idleSalesLeads: number;
  prospects: number;
  prospectsNeedRouting: number;
  prospectsReadyToPush: number;
  prospectsPushed: number;
  followupsDue: number;
  overdueFollowups: number;
  /** Leads with a detected reply (lifetime / current pipeline). */
  totalReplies: number;
  repliesPendingReview: number;
  /** Open pipeline $ (open deals + lead estimates without open deal). */
  openPipelineValue: number;
  openDealCount: number;
  leadEstimateContributors: number;
  /**
   * Sales-lead counts by pipeline stage (P0.9).
   * Keys are `PipelineStage`; missing stages mean 0.
   */
  pipelineByStage: Record<string, number>;
  /**
   * Sales-lead volume + wins per channel (P0.10).
   * Keys are `ChannelKey`; missing channels mean 0.
   */
  channelMix: Record<string, { count: number; won: number }>;
  /**
   * Funnel stage counts per channel (P0.10) — pipeline-derived, no activityCounters.
   */
  funnelByChannel: Record<string, Record<string, number>>;
  /** Precomputed windows; missing keys mean “not yet written”. */
  ranges: Partial<Record<OrgDashboardSummaryRangeKey, OrgDashboardSummaryRangeMetrics>>;
};

export const orgDashboardSummaryRangeMetricsSchema = z.object({
  sent: z.number().finite().nonnegative(),
  replies: z.number().finite().nonnegative(),
  opens: z.number().finite().nonnegative(),
  bounced: z.number().finite().nonnegative(),
  closedRevenue: z.number().finite().nonnegative(),
  wonDealCount: z.number().finite().nonnegative(),
});

export const orgDashboardSummarySchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  version: z.literal(ORG_DASHBOARD_SUMMARY_VERSION),
  updatedAt: z.string().min(1),
  openSalesLeads: z.number().finite().nonnegative(),
  idleSalesLeads: z.number().finite().nonnegative(),
  prospects: z.number().finite().nonnegative(),
  prospectsNeedRouting: z.number().finite().nonnegative(),
  prospectsReadyToPush: z.number().finite().nonnegative(),
  prospectsPushed: z.number().finite().nonnegative(),
  followupsDue: z.number().finite().nonnegative(),
  overdueFollowups: z.number().finite().nonnegative(),
  totalReplies: z.number().finite().nonnegative(),
  repliesPendingReview: z.number().finite().nonnegative(),
  openPipelineValue: z.number().finite().nonnegative(),
  openDealCount: z.number().finite().nonnegative(),
  leadEstimateContributors: z.number().finite().nonnegative(),
  pipelineByStage: z.record(z.string(), z.number().finite().nonnegative()).default({}),
  channelMix: z
    .record(
      z.string(),
      z.object({
        count: z.number().finite().nonnegative(),
        won: z.number().finite().nonnegative(),
      }),
    )
    .default({}),
  funnelByChannel: z
    .record(z.string(), z.record(z.string(), z.number().finite().nonnegative()))
    .default({}),
  ranges: z.partialRecord(
    z.enum(ORG_DASHBOARD_SUMMARY_RANGE_KEYS),
    orgDashboardSummaryRangeMetricsSchema,
  ),
});

export function emptyOrgDashboardSummaryRangeMetrics(): OrgDashboardSummaryRangeMetrics {
  return {
    sent: 0,
    replies: 0,
    opens: 0,
    bounced: 0,
    closedRevenue: 0,
    wonDealCount: 0,
  };
}

/** Zeroed summary document for a tenant (before first writer / ETL). */
export function emptyOrgDashboardSummary(
  organizationId: string,
  updatedAt: string = new Date().toISOString(),
): OrgDashboardSummary {
  return {
    id: organizationId,
    organizationId,
    version: ORG_DASHBOARD_SUMMARY_VERSION,
    updatedAt,
    openSalesLeads: 0,
    idleSalesLeads: 0,
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

/** Firestore document id for the org summary (one doc per org). */
export function orgDashboardSummaryDocId(organizationId: string): string {
  return organizationId;
}

/** Redis key used by P0.2 cache helper (versioned). */
export function orgDashboardSummaryCacheKey(organizationId: string): string {
  return `dash:summary:v${ORG_DASHBOARD_SUMMARY_VERSION}:${organizationId}`;
}

/**
 * Parse unknown Firestore/Redis JSON into a typed summary.
 * Returns null when invalid (caller falls back to live aggregation / flag-off path).
 */
export function parseOrgDashboardSummary(raw: unknown): OrgDashboardSummary | null {
  const result = orgDashboardSummarySchema.safeParse(raw);
  if (!result.success) return null;
  if (result.data.id !== result.data.organizationId) return null;
  return result.data;
}

/** Minimal lead fields needed for open / idle sales-lead gauges. */
export type OpenSalesLeadFields = {
  intakeKind?: string | null;
  stage?: string | null;
  isIdle?: boolean | null;
};

/**
 * Matches `computeDashboardWorkflowMetrics.openSalesLeads`:
 * sales lead (`intakeKind !== "prospect"`) and stage not won/lost.
 */
export function leadCountsTowardOpenSalesLeads(lead: OpenSalesLeadFields | null | undefined): boolean {
  if (!lead) return false;
  if (lead.intakeKind === "prospect") return false;
  const stage = typeof lead.stage === "string" ? lead.stage : "";
  return stage !== "won" && stage !== "lost";
}

/**
 * Matches `computeDashboardWorkflowMetrics.idleSalesLeads`:
 * open sales lead with `isIdle === true`.
 */
export function leadCountsTowardIdleSalesLeads(lead: OpenSalesLeadFields | null | undefined): boolean {
  return leadCountsTowardOpenSalesLeads(lead) && Boolean(lead?.isIdle);
}

/**
 * Delta to apply to `orgDashboardSummaries.openSalesLeads` for a lead create/update/delete.
 * `before`/`after` are null when the document did not exist / was deleted.
 */
export function openSalesLeadsContributionDelta(
  before: OpenSalesLeadFields | null | undefined,
  after: OpenSalesLeadFields | null | undefined,
): number {
  const was = leadCountsTowardOpenSalesLeads(before) ? 1 : 0;
  const now = leadCountsTowardOpenSalesLeads(after) ? 1 : 0;
  return now - was;
}

/** Delta for `orgDashboardSummaries.idleSalesLeads` (P0.7). */
export function idleSalesLeadsContributionDelta(
  before: OpenSalesLeadFields | null | undefined,
  after: OpenSalesLeadFields | null | undefined,
): number {
  const was = leadCountsTowardIdleSalesLeads(before) ? 1 : 0;
  const now = leadCountsTowardIdleSalesLeads(after) ? 1 : 0;
  return now - was;
}

/** Raw rows for pipeline gauge recompute (P0.8). */
export type PipelineLeadFields = {
  id: string;
  intakeKind?: string | null;
  stage?: string | null;
  estimatedValue?: number | null;
};

export type PipelineDealFields = {
  leadId?: string | null;
  stage?: string | null;
  value?: number | null;
};

/**
 * Same rules as `computeOpenPipelineMetrics` — sales leads only for estimates;
 * open deals (any lead) contribute value + count.
 */
export function computeOrgOpenPipelineGauges(
  leads: readonly PipelineLeadFields[],
  deals: readonly PipelineDealFields[],
): {
  openPipelineValue: number;
  openDealCount: number;
  leadEstimateContributors: number;
} {
  const openDeals = deals.filter((d) => {
    const stage = typeof d.stage === "string" ? d.stage : "";
    return stage !== "won" && stage !== "lost";
  });
  const leadIdsWithOpenDeal = new Set(
    openDeals.map((d) => (typeof d.leadId === "string" ? d.leadId : "")).filter(Boolean),
  );
  const fromDeals = openDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);

  const salesLeads = leads.filter((l) => l.intakeKind !== "prospect");
  const openLeadsWithoutOpenDeal = salesLeads.filter((l) => {
    const stage = typeof l.stage === "string" ? l.stage : "";
    return stage !== "won" && stage !== "lost" && !leadIdsWithOpenDeal.has(l.id);
  });
  const fromLeadEstimates = openLeadsWithoutOpenDeal.reduce(
    (s, l) => s + (Number(l.estimatedValue) || 0),
    0,
  );
  const leadEstimateContributors = openLeadsWithoutOpenDeal.filter(
    (l) => (Number(l.estimatedValue) || 0) > 0,
  ).length;

  return {
    openPipelineValue: fromDeals + fromLeadEstimates,
    openDealCount: openDeals.length,
    leadEstimateContributors,
  };
}

/**
 * Sales-lead counts by stage (matches PipelineDistribution over sales leads).
 * Prospects are excluded.
 */
export function computePipelineByStage(
  leads: readonly PipelineLeadFields[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const lead of leads) {
    if (lead.intakeKind === "prospect") continue;
    const stage = typeof lead.stage === "string" && lead.stage ? lead.stage : "new";
    counts[stage] = (counts[stage] ?? 0) + 1;
  }
  return counts;
}

/** True when a lead write can change pipeline-by-stage distribution. */
export function leadWriteAffectsPipelineByStage(
  before: PipelineLeadFields | null | undefined,
  after: PipelineLeadFields | null | undefined,
): boolean {
  if (!before && !after) return false;
  if (!before || !after) return true;
  return before.intakeKind !== after.intakeKind || before.stage !== after.stage;
}

/** True when a lead write can change open-pipeline gauges. */
export function leadWriteAffectsOpenPipeline(
  before: PipelineLeadFields | null | undefined,
  after: PipelineLeadFields | null | undefined,
): boolean {
  if (!before && !after) return false;
  if (!before || !after) return true;
  return (
    before.intakeKind !== after.intakeKind ||
    before.stage !== after.stage ||
    Number(before.estimatedValue ?? 0) !== Number(after.estimatedValue ?? 0)
  );
}

/** True when a deal write can change open-pipeline gauges. */
export function dealWriteAffectsOpenPipeline(
  before: PipelineDealFields | null | undefined,
  after: PipelineDealFields | null | undefined,
): boolean {
  if (!before && !after) return false;
  if (!before || !after) return true;
  return (
    before.stage !== after.stage ||
    Number(before.value ?? 0) !== Number(after.value ?? 0) ||
    before.leadId !== after.leadId
  );
}
