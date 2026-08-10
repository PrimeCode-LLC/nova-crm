/**
 * Apply precomputed org summary onto live workflow metrics (P0.6–P0.10).
 * Person-scoped fields (myOpenTasks, …) stay from live. Range fields only
 * override when `rangeKey` is a precomputed window.
 */

import type { DashboardWorkflowMetrics } from "@/lib/dashboard-workflow";
import {
  ORG_DASHBOARD_SUMMARY_RANGE_KEYS,
  type OrgDashboardSummary,
  type OrgDashboardSummaryRangeKey,
} from "@/lib/dashboard-summary";

function isSummaryRangeKey(value: string): value is OrgDashboardSummaryRangeKey {
  return (ORG_DASHBOARD_SUMMARY_RANGE_KEYS as readonly string[]).includes(value);
}

export function applyOrgDashboardSummaryToWorkflowMetrics(
  live: DashboardWorkflowMetrics,
  summary: OrgDashboardSummary,
  rangeKey: string,
): DashboardWorkflowMetrics {
  const next = { ...live };
  const assign = <K extends keyof DashboardWorkflowMetrics>(
    key: K,
    value: unknown,
  ) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      next[key] = Math.max(0, value) as DashboardWorkflowMetrics[K];
    }
  };

  assign("openSalesLeads", summary.openSalesLeads);
  assign("idleSalesLeads", summary.idleSalesLeads);
  assign("prospects", summary.prospects);
  assign("prospectsNeedRouting", summary.prospectsNeedRouting);
  assign("prospectsReadyToPush", summary.prospectsReadyToPush);
  assign("prospectsPushed", summary.prospectsPushed);
  assign("followupsDue", summary.followupsDue);
  assign("overdueFollowups", summary.overdueFollowups);
  assign("totalReplies", summary.totalReplies);
  assign("repliesPendingReview", summary.repliesPendingReview);

  if (isSummaryRangeKey(rangeKey)) {
    const window = summary.ranges?.[rangeKey];
    if (window) {
      assign("sentInRange", window.sent);
      assign("repliesInRange", window.replies);
      assign("opensInRange", window.opens);
      assign("bouncedEmailsInRange", window.bounced);
    }
  }

  return next;
}

export function summaryClosedRevenue(
  summary: OrgDashboardSummary | null | undefined,
  rangeKey: string,
): { closedRevenue: number; wonDealCount: number } | null {
  if (!summary || !isSummaryRangeKey(rangeKey)) return null;
  const window = summary.ranges?.[rangeKey];
  if (!window) return null;
  return {
    closedRevenue: Math.max(0, window.closedRevenue),
    wonDealCount: Math.max(0, window.wonDealCount),
  };
}
