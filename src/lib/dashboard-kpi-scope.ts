/**
 * Dashboard KPI visibility scope — must match hierarchy rules used for rows.
 *
 * Org-wide precomputed summaries (`orgDashboardSummaries`) may only overlay KPIs
 * when the viewer genuinely has tenant-wide CRM visibility. Default filter
 * `all-owners` does **not** by itself mean organization-wide access.
 */

import { isFrontlineDashboardRole } from "@/lib/dashboard-role-focus";
import { filterLeadTasksForViewer } from "@/lib/lead-task-visibility";
import type { Deal, Followup, Lead, LeadTask, Role, User } from "@/lib/types";
import {
  activityActorUserIdsVisibleToViewer,
  followupVisibleInHierarchyScope,
  leadOwnerIdsVisibleToViewer,
  leadVisibleForLiveViewer,
  seesAllLeadsInTenant,
} from "@/lib/workspace-hierarchy";

export type DashboardKpiAccessScope = "org" | "team" | "own";

/**
 * Effective viewer for KPI / row visibility when "Preview as role" is active.
 * Strips org-wide privileges so a director previewing salesperson sees own-scope KPIs.
 */
export function resolveDashboardKpiViewer(
  viewer: User | undefined,
  previewRole?: Role | null,
): User | undefined {
  if (!viewer) return undefined;
  if (!previewRole || previewRole === viewer.roleId) return viewer;

  if (previewRole === "director") {
    return {
      ...viewer,
      roleId: "director",
      // Keep elevated org role so director preview still sees org-wide when applicable.
      isSuperAdmin: viewer.isSuperAdmin,
    };
  }

  const teamLike = previewRole === "manager" || previewRole === "team_lead";
  return {
    ...viewer,
    roleId: previewRole,
    orgRole: teamLike ? "manager" : "member",
    isSuperAdmin: false,
  };
}

/** Coarse access bucket for tests / diagnostics (aligned with hierarchy helpers). */
export function resolveDashboardKpiAccessScope(
  viewer: User | undefined,
  previewRole?: Role | null,
): DashboardKpiAccessScope {
  const kpiViewer = resolveDashboardKpiViewer(viewer, previewRole);
  if (!kpiViewer) return "own";
  if (seesAllLeadsInTenant(kpiViewer)) return "org";
  if (
    kpiViewer.roleId === "manager" ||
    kpiViewer.roleId === "team_lead" ||
    kpiViewer.orgRole === "manager"
  ) {
    return "team";
  }
  if (isFrontlineDashboardRole(kpiViewer.roleId) || kpiViewer.roleId === "content_team") {
    return "own";
  }
  // Fallback: anyone with reports is team-scoped via hierarchy; otherwise own.
  return "team";
}

/**
 * Whether the precomputed **organization-wide** dashboard summary may replace
 * live KPI aggregation.
 */
export function canApplyOrgWideDashboardSummary(input: {
  viewer: User | undefined;
  previewRole?: Role | null;
  /** True when no channel filter is applied. */
  channelScopeEmpty: boolean;
  /** True when owner filter is the default `all-owners`. */
  ownerScopeIsAll: boolean;
}): boolean {
  if (!input.channelScopeEmpty || !input.ownerScopeIsAll) return false;
  const kpiViewer = resolveDashboardKpiViewer(input.viewer, input.previewRole);
  if (!kpiViewer) return false;
  return seesAllLeadsInTenant(kpiViewer);
}

export type DashboardKpiScopedSlice = {
  leads: Lead[];
  deals: Deal[];
  followups: Followup[];
  leadTasks: LeadTask[];
};

/**
 * Narrow workspace arrays to the KPI viewer's hierarchy visibility.
 * No-op when the viewer already has tenant-wide access (data may be full org).
 */
export function scopeDashboardEntitiesForKpiViewer(input: {
  viewer: User | undefined;
  previewRole?: Role | null;
  orgUsers: readonly User[];
  leads: readonly Lead[];
  deals: readonly Deal[];
  followups: readonly Followup[];
  leadTasks: readonly LeadTask[];
}): DashboardKpiScopedSlice {
  const kpiViewer = resolveDashboardKpiViewer(input.viewer, input.previewRole);
  if (!kpiViewer || seesAllLeadsInTenant(kpiViewer)) {
    return {
      leads: [...input.leads],
      deals: [...input.deals],
      followups: [...input.followups],
      leadTasks: [...input.leadTasks],
    };
  }

  const visibleOwnerIds = leadOwnerIdsVisibleToViewer(kpiViewer, input.orgUsers);
  const leads = input.leads.filter((l) =>
    leadVisibleForLiveViewer(l, kpiViewer, input.orgUsers, visibleOwnerIds),
  );
  const visibleLeadIds = new Set(leads.map((l) => l.id));
  const deals = input.deals.filter((d) => visibleLeadIds.has(d.leadId));
  const visibleDealIds = new Set(deals.map((d) => d.id));
  const activityActorIds = activityActorUserIdsVisibleToViewer(kpiViewer, input.orgUsers)!;
  const followups = input.followups.filter((f) =>
    followupVisibleInHierarchyScope(f, visibleLeadIds, visibleDealIds, activityActorIds),
  );
  const leadTasks = filterLeadTasksForViewer(input.leadTasks, kpiViewer, input.orgUsers);

  return { leads, deals, followups, leadTasks };
}
