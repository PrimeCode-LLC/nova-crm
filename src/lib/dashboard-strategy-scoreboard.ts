import { getDashboardRangeStart, type DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import { isSalesLead } from "@/lib/dashboard-workflow";
import type { ProspectingStrategy, StrategyAssignment } from "@/lib/prospecting-strategy/types";
import type { Deal, Followup, Lead } from "@/lib/types";

export type StrategyScoreboardRow = {
  strategyId: string;
  name: string;
  status: ProspectingStrategy["status"];
  /** Active assignments currently working this strategy. */
  activeAssignees: number;
  prospects: number;
  avgQuality: number | null;
  qualified: number;
  qualifiedRate: number;
  salesLeads: number;
  emailsSent: number;
  replies: number;
  replyRate: number;
  openPipeline: number;
  closedValue: number;
  wonCount: number;
  /** Too few prospects for rates to be meaningful. */
  thinSample: boolean;
  /** 0–100 composite for sorting (quality + conversion, not raw volume). */
  score: number;
};

const THIN_SAMPLE_MIN = 10;

function validTime(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : undefined;
}

function inWindow(iso: string | undefined, start: number): boolean {
  const t = validTime(iso);
  return t !== undefined && t >= start;
}

/**
 * Active = published strategies only (draft / paused / archived stay off the board).
 * Metrics are attributed via lead.strategyId in the selected range.
 */
export function buildStrategyScoreboardRows(input: {
  strategies: readonly ProspectingStrategy[];
  assignments: readonly StrategyAssignment[];
  leads: readonly Lead[];
  deals: readonly Deal[];
  followups: readonly Followup[];
  range: DashboardTimeRangeKey;
  outreachThreshold: number;
  now?: Date;
}): {
  rows: StrategyScoreboardRow[];
  /** Share of prospects in-range that carry a strategyId. */
  attributionCoverage: number;
  prospectsInRange: number;
  attributedInRange: number;
} {
  const now = input.now ?? new Date();
  const start = getDashboardRangeStart(input.range, now).getTime();
  const threshold = input.outreachThreshold;

  const published = input.strategies.filter((s) => s.status === "published");
  const activeByStrategy = new Map<string, number>();
  for (const a of input.assignments) {
    if (a.status !== "active") continue;
    activeByStrategy.set(a.strategyId, (activeByStrategy.get(a.strategyId) ?? 0) + 1);
  }

  const prospectsInRange = input.leads.filter(
    (l) => l.intakeKind === "prospect" && inWindow(l.createdAt, start),
  );
  const attributedInRange = prospectsInRange.filter((l) => Boolean(l.strategyId)).length;
  const attributionCoverage =
    prospectsInRange.length > 0 ? (attributedInRange / prospectsInRange.length) * 100 : 0;

  const openDeals = input.deals.filter((d) => !["won", "lost"].includes(d.stage));
  const leadIdsWithOpenDeal = new Set(openDeals.map((d) => d.leadId));

  const rows: StrategyScoreboardRow[] = published.map((strategy) => {
    const myProspects = prospectsInRange.filter((l) => l.strategyId === strategy.id);
    const scored = myProspects.filter((l) => typeof l.qualityScore === "number");
    const qualitySum = scored.reduce((s, l) => s + (l.qualityScore ?? 0), 0);
    const avgQuality = scored.length > 0 ? qualitySum / scored.length : null;
    const qualified = myProspects.filter((l) => (l.qualityScore ?? 0) >= threshold).length;
    const qualifiedRate = myProspects.length > 0 ? (qualified / myProspects.length) * 100 : 0;

    // Sales leads that were created from this strategy's prospects (same strategyId retained on promote).
    const salesLeads = input.leads.filter(
      (l) =>
        isSalesLead(l) &&
        l.strategyId === strategy.id &&
        inWindow(l.createdAt, start),
    );
    const salesLeadIds = new Set(salesLeads.map((l) => l.id));

    const emailsSent = input.followups.filter(
      (f) =>
        f.deliveryStatus === "sent" &&
        f.leadId &&
        salesLeadIds.has(f.leadId) &&
        inWindow(f.sentAt, start),
    ).length;

    const replies = salesLeads.filter((l) => inWindow(l.lastReplyAt, start)).length;
    const replyRate = emailsSent > 0 ? (replies / emailsSent) * 100 : 0;

    const openPipeline = salesLeads
      .filter((l) => !["won", "lost"].includes(l.stage))
      .reduce((sum, l) => {
        const deals = openDeals.filter((d) => d.leadId === l.id);
        if (deals.length) return sum + deals.reduce((s, d) => s + d.value, 0);
        if (!leadIdsWithOpenDeal.has(l.id)) return sum + (l.estimatedValue ?? 0);
        return sum;
      }, 0);

    const wonDeals = input.deals.filter(
      (d) =>
        d.stage === "won" &&
        salesLeadIds.has(d.leadId) &&
        inWindow(d.updatedAt ?? d.createdAt, start),
    );
    const closedValue = wonDeals.reduce((s, d) => s + d.value, 0);
    const wonCount = wonDeals.length;

    const thinSample = myProspects.length > 0 && myProspects.length < THIN_SAMPLE_MIN;

    // Quality-weighted score for ranking (not raw volume).
    const qualityFactor = avgQuality == null ? 0 : avgQuality / 100;
    const score = Math.round(
      qualified * 3 +
        myProspects.length * qualityFactor * 1.5 +
        salesLeads.length * 4 +
        replies * 5 +
        wonCount * 8 +
        closedValue / 1000,
    );

    return {
      strategyId: strategy.id,
      name: strategy.name?.trim() || "Untitled strategy",
      status: strategy.status,
      activeAssignees: activeByStrategy.get(strategy.id) ?? 0,
      prospects: myProspects.length,
      avgQuality,
      qualified,
      qualifiedRate,
      salesLeads: salesLeads.length,
      emailsSent,
      replies,
      replyRate,
      openPipeline,
      closedValue,
      wonCount,
      thinSample,
      score,
    };
  });

  rows.sort((a, b) => b.score - a.score || b.prospects - a.prospects);

  return {
    rows,
    attributionCoverage,
    prospectsInRange: prospectsInRange.length,
    attributedInRange,
  };
}

export const STRATEGY_SCOREBOARD_THIN_SAMPLE_MIN = THIN_SAMPLE_MIN;
