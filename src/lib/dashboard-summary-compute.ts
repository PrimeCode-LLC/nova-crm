/**
 * Pure org-wide KPI compute for `orgDashboardSummaries` (P0.10).
 * Matches Overview live aggregations when scope is unfiltered.
 */

import { CHANNEL_FUNNELS, CHANNEL_LIST, PIPELINE_STAGES } from "@/lib/constants";
import { getDashboardRangeStart } from "@/lib/dashboard-date-range";
import { aggregateChannelFunnelCounts } from "@/lib/dashboard-analytics";
import {
  isFollowupDueThroughToday,
  isFollowupOverdue,
} from "@/lib/followup-open-status";
import { hasPendingReplyReview } from "@/lib/leads/reply-review";
import type { ChannelKey, Deal, Followup, Lead, PipelineStage } from "@/lib/types";
import {
  ORG_DASHBOARD_SUMMARY_RANGE_KEYS,
  computeOrgOpenPipelineGauges,
  computePipelineByStage,
  emptyOrgDashboardSummaryRangeMetrics,
  leadCountsTowardIdleSalesLeads,
  leadCountsTowardOpenSalesLeads,
  type OrgDashboardSummary,
  type OrgDashboardSummaryRangeKey,
  type OrgDashboardSummaryRangeMetrics,
} from "@/lib/dashboard-summary";

const STAGE_ORDER = PIPELINE_STAGES.map((s) => s.key);

function stageAtOrAfterReplied(stage: string): boolean {
  const index = STAGE_ORDER.indexOf(stage as PipelineStage);
  const repliedIndex = STAGE_ORDER.indexOf("replied");
  return index >= 0 && repliedIndex >= 0 && index >= repliedIndex && stage !== "lost";
}

function leadHasReply(lead: Pick<Lead, "lastReplyAt" | "stage">): boolean {
  return Boolean(lead.lastReplyAt) || stageAtOrAfterReplied(lead.stage);
}

function prospectNeedsRouting(lead: Pick<Lead, "intakeKind" | "prospectChannelAssignments">): boolean {
  if (lead.intakeKind !== "prospect") return false;
  return (lead.prospectChannelAssignments ?? []).length === 0;
}

function prospectReadyToPush(lead: Pick<Lead, "intakeKind" | "prospectChannelAssignments">): boolean {
  if (lead.intakeKind !== "prospect") return false;
  const assignments = lead.prospectChannelAssignments ?? [];
  if (assignments.length === 0) return false;
  return assignments.some((assignment) => !assignment.pushedAt);
}

function validTime(iso: string | undefined | null): number | undefined {
  if (!iso) return undefined;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : undefined;
}

export type OrgChannelMixRow = { count: number; won: number };

/** Sales-lead volume + wins per channel (matches ChannelMix widget). */
export function computeChannelMix(
  leads: readonly Pick<Lead, "channel" | "stage" | "intakeKind">[],
): Record<string, OrgChannelMixRow> {
  const out: Record<string, OrgChannelMixRow> = {};
  for (const lead of leads) {
    if (lead.intakeKind === "prospect") continue;
    const key = typeof lead.channel === "string" && lead.channel ? lead.channel : "";
    if (!key) continue;
    const row = out[key] ?? { count: 0, won: 0 };
    row.count += 1;
    if (lead.stage === "won") row.won += 1;
    out[key] = row;
  }
  return out;
}

/** Per-channel funnel counts (activityCounters unused — pipeline only). */
export function computeFunnelByChannel(
  leads: readonly Lead[],
  deals: readonly Deal[],
): Record<string, Record<string, number>> {
  const salesLeads = leads.filter((l) => l.intakeKind !== "prospect") as Lead[];
  const out: Record<string, Record<string, number>> = {};
  for (const meta of CHANNEL_LIST) {
    const key = meta.key as ChannelKey;
    if (!(key in CHANNEL_FUNNELS)) continue;
    out[key] = aggregateChannelFunnelCounts(key, [], salesLeads, deals as Deal[]);
  }
  return out;
}

export function computeOrgPointInTimeGauges(input: {
  leads: readonly Lead[];
  followups: readonly Followup[];
  timeZone?: string;
  now?: Date;
}): Pick<
  OrgDashboardSummary,
  | "openSalesLeads"
  | "idleSalesLeads"
  | "prospects"
  | "prospectsNeedRouting"
  | "prospectsReadyToPush"
  | "prospectsPushed"
  | "followupsDue"
  | "overdueFollowups"
  | "totalReplies"
  | "repliesPendingReview"
> {
  const now = input.now ?? new Date();
  const timeOpts = { now, timeZone: input.timeZone };
  let openSalesLeads = 0;
  let idleSalesLeads = 0;
  let prospects = 0;
  let prospectsNeedRouting = 0;
  let prospectsReadyToPush = 0;
  let prospectsPushed = 0;
  let totalReplies = 0;
  let repliesPendingReview = 0;

  for (const lead of input.leads) {
    if (leadCountsTowardOpenSalesLeads(lead)) openSalesLeads += 1;
    if (leadCountsTowardIdleSalesLeads(lead)) idleSalesLeads += 1;
    if (lead.intakeKind === "prospect") {
      prospects += 1;
      if (prospectNeedsRouting(lead)) prospectsNeedRouting += 1;
      if (prospectReadyToPush(lead)) prospectsReadyToPush += 1;
      if (lead.linkedSalesLeadId) prospectsPushed += 1;
    }
    if (leadHasReply(lead)) totalReplies += 1;
    if (hasPendingReplyReview(lead)) repliesPendingReview += 1;
  }

  const dueFollowups = input.followups.filter((followup) =>
    isFollowupDueThroughToday(followup, timeOpts),
  );

  return {
    openSalesLeads,
    idleSalesLeads,
    prospects,
    prospectsNeedRouting,
    prospectsReadyToPush,
    prospectsPushed,
    followupsDue: dueFollowups.length,
    overdueFollowups: dueFollowups.filter((f) => isFollowupOverdue(f, timeOpts)).length,
    totalReplies,
    repliesPendingReview,
  };
}

export function computeOrgRangeMetrics(input: {
  leads: readonly Lead[];
  followups: readonly Followup[];
  deals: readonly Deal[];
  range: OrgDashboardSummaryRangeKey;
  timeZone?: string;
  now?: Date;
}): OrgDashboardSummaryRangeMetrics {
  const now = input.now ?? new Date();
  const start = getDashboardRangeStart(input.range, {
    now,
    timeZone: input.timeZone,
  }).getTime();

  let sent = 0;
  for (const followup of input.followups) {
    const sentAt = validTime(followup.sentAt);
    if (followup.deliveryStatus === "sent" && sentAt !== undefined && sentAt >= start) {
      sent += 1;
    }
  }

  let replies = 0;
  let opens = 0;
  for (const lead of input.leads) {
    const repliedAt = validTime(lead.lastReplyAt);
    if (repliedAt !== undefined && repliedAt >= start) replies += 1;
    const openedAt = validTime(lead.lastEmailOpenedAt);
    if (openedAt !== undefined && openedAt >= start) opens += 1;
  }

  let closedRevenue = 0;
  let wonDealCount = 0;
  for (const deal of input.deals) {
    if (deal.stage !== "won") continue;
    if (input.range !== "all") {
      const inWindow =
        (validTime(deal.wonAt) !== undefined && (validTime(deal.wonAt) as number) >= start) ||
        (validTime(deal.updatedAt) !== undefined && (validTime(deal.updatedAt) as number) >= start) ||
        (validTime(deal.createdAt) !== undefined && (validTime(deal.createdAt) as number) >= start);
      if (!inWindow) continue;
    }
    closedRevenue += Number(deal.value) || 0;
    wonDealCount += 1;
  }

  return {
    ...emptyOrgDashboardSummaryRangeMetrics(),
    sent,
    replies,
    opens,
    closedRevenue,
    wonDealCount,
  };
}

export function computeAllOrgRangeMetrics(input: {
  leads: readonly Lead[];
  followups: readonly Followup[];
  deals: readonly Deal[];
  timeZone?: string;
  now?: Date;
}): OrgDashboardSummary["ranges"] {
  const ranges: OrgDashboardSummary["ranges"] = {};
  for (const key of ORG_DASHBOARD_SUMMARY_RANGE_KEYS) {
    ranges[key] = computeOrgRangeMetrics({ ...input, range: key });
  }
  return ranges;
}

/** Build every org-wide summary field except id / organizationId / version / updatedAt. */
export function computeOrgDashboardSummaryFields(input: {
  leads: readonly Lead[];
  deals: readonly Deal[];
  followups: readonly Followup[];
  timeZone?: string;
  now?: Date;
}): Omit<OrgDashboardSummary, "id" | "organizationId" | "version" | "updatedAt"> {
  const point = computeOrgPointInTimeGauges(input);
  const pipelineLeads = input.leads.map((l) => ({
    id: l.id,
    intakeKind: l.intakeKind,
    stage: l.stage,
    estimatedValue: l.estimatedValue ?? null,
  }));
  const pipelineDeals = input.deals.map((d) => ({
    leadId: d.leadId,
    stage: d.stage,
    value: d.value,
  }));
  const gauges = computeOrgOpenPipelineGauges(pipelineLeads, pipelineDeals);
  return {
    ...point,
    ...gauges,
    pipelineByStage: computePipelineByStage(pipelineLeads),
    channelMix: computeChannelMix(input.leads),
    funnelByChannel: computeFunnelByChannel(input.leads as Lead[], input.deals as Deal[]),
    ranges: computeAllOrgRangeMetrics(input),
  };
}
