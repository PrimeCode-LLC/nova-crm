/**
 * Dashboard KPI visibility scope — must match hierarchy rules used for rows.
 *
 * Org-wide precomputed summaries (`orgDashboardSummaries`) may only overlay KPIs
 * when the viewer genuinely has tenant-wide CRM visibility. Default filter
 * `all-owners` does **not** by itself mean organization-wide access.
 */

import { filterLeadsByDateRange, type DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import { isFrontlineDashboardRole } from "@/lib/dashboard-role-focus";
import { filterLeadTasksForViewer } from "@/lib/lead-task-visibility";
import { filterLeadsByOwnerScope, type OwnerScopeDeps } from "@/lib/owner-scope";
import type { ChannelKey, Deal, Followup, Lead, LeadTask, Role, User } from "@/lib/types";
import {
  activityActorUserIdsVisibleToViewer,
  followupVisibleInHierarchyScope,
  leadOwnerIdsVisibleToViewer,
  leadVisibleForLiveViewer,
  seesAllLeadsInTenant,
} from "@/lib/workspace-hierarchy";

/** Same ceiling as `useRememberLeadsByIds` — Needs attention shows at most 8 rows. */
export const WORKFLOW_LINK_LEAD_CAP = 100;

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
  /** When the live CRM snapshot is empty, do not drop rows whose lead is not loaded. */
  snapshotCutoverActive?: boolean;
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
  const deals = input.snapshotCutoverActive
    ? [...input.deals]
    : input.deals.filter((d) => visibleLeadIds.has(d.leadId));
  const visibleDealIds = new Set(deals.map((d) => d.id));
  const activityActorIds = activityActorUserIdsVisibleToViewer(kpiViewer, input.orgUsers)!;
  const followups = input.followups.filter((f) =>
    followupVisibleInHierarchyScope(f, visibleLeadIds, visibleDealIds, activityActorIds, {
      snapshotCutoverActive: input.snapshotCutoverActive,
    }),
  );
  const leadTasks = filterLeadTasksForViewer(input.leadTasks, kpiViewer, input.orgUsers);

  return { leads, deals, followups, leadTasks };
}

/**
 * Lead ids referenced by follow-ups, tasks, and plans, capped so the snapshot-off
 * dashboard can hydrate them without a full `all=1` snapshot.
 */
export function collectWorkflowLinkLeadIds(input: {
  followups: readonly { leadId?: string | null }[];
  leadTasks: readonly { leadId?: string | null }[];
  plans: readonly { leadId?: string | null }[];
}): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (leadId?: string | null) => {
    const id = leadId?.trim();
    if (!id || seen.has(id) || ids.length >= WORKFLOW_LINK_LEAD_CAP) return;
    seen.add(id);
    ids.push(id);
  };
  for (const row of input.followups) push(row.leadId);
  for (const row of input.leadTasks) push(row.leadId);
  for (const row of input.plans) push(row.leadId);
  return ids;
}

export type WorkflowLeadGate = {
  gateLeadIds: ReadonlySet<string>;
  followups: Followup[];
  leadTasks: LeadTask[];
};

/**
 * Lead ids that may keep a workflow row on the dashboard.
 * Snapshot-on returns `scopedLeadIds` unchanged.
 * Snapshot-off hierarchy-scopes the hydrated link leads, then applies the same
 * channel, owner, and date filters as the full snapshot path.
 */
export function resolveWorkflowLeadGate(input: {
  snapshotLeadsEmpty: boolean;
  scopedLeadIds: ReadonlySet<string>;
  followups: readonly Followup[];
  leadTasks: readonly LeadTask[];
  linkLeads: readonly Lead[];
  viewer: User | undefined;
  previewRole?: Role | null;
  orgUsers: readonly User[];
  channelScope: readonly ChannelKey[];
  ownerScope: string;
  ownerScopeDeps: OwnerScopeDeps;
  timeRange: DashboardTimeRangeKey;
  timeZone?: string | null;
  now?: Date;
}): WorkflowLeadGate {
  if (!input.snapshotLeadsEmpty) {
    return {
      gateLeadIds: input.scopedLeadIds,
      followups: [...input.followups],
      leadTasks: [...input.leadTasks],
    };
  }

  const scoped = scopeDashboardEntitiesForKpiViewer({
    viewer: input.viewer,
    previewRole: input.previewRole,
    orgUsers: input.orgUsers,
    leads: input.linkLeads,
    deals: [],
    followups: input.followups,
    leadTasks: input.leadTasks,
    snapshotCutoverActive: true,
  });
  const channelScoped =
    input.channelScope.length > 0
      ? scoped.leads.filter((lead) => input.channelScope.includes(lead.channel))
      : scoped.leads;
  const ownerScoped = filterLeadsByOwnerScope(
    channelScoped,
    input.ownerScope,
    input.ownerScopeDeps,
  );
  const dated = filterLeadsByDateRange(ownerScoped, input.timeRange, {
    timeZone: input.timeZone ?? undefined,
    now: input.now,
  });
  return {
    gateLeadIds: new Set(dated.map((lead) => lead.id)),
    followups: scoped.followups,
    leadTasks: scoped.leadTasks,
  };
}

/** Keep a row with no lead, or a row whose lead is inside the gate. */
export function filterOptionalLeadRows<T extends { leadId?: string | null }>(
  rows: readonly T[],
  gateLeadIds: ReadonlySet<string>,
): T[] {
  return rows.filter((row) => !row.leadId || gateLeadIds.has(row.leadId));
}

/** Plans require a lead that passed the gate. */
export function filterRequiredLeadRows<T extends { leadId?: string | null }>(
  rows: readonly T[],
  gateLeadIds: ReadonlySet<string>,
): T[] {
  return rows.filter((row) => Boolean(row.leadId) && gateLeadIds.has(row.leadId as string));
}
