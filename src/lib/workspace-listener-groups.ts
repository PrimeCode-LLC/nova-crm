/**
 * Named Firestore listener groups for route-scoped, sticky subscriptions.
 * Groups attach on first need and stay attached for the session.
 */

export const WORKSPACE_LISTENER_GROUPS = [
  "core",
  "directory",
  "deals",
  "plans",
  /** Capped timeline feed only — use on dashboard instead of full leadDetail. */
  "timeline",
  /** Notes + touchpoints + timeline (lead/account detail routes). */
  "leadDetail",
  "activity",
  "campaigns",
] as const;

export type WorkspaceListenerGroup = (typeof WORKSPACE_LISTENER_GROUPS)[number];

/** Always attached — shell (topbar, inbox notifications, followup due sync). */
export const CORE_WORKSPACE_GROUPS: ReadonlySet<WorkspaceListenerGroup> = new Set([
  "core",
]);

/**
 * Map a pathname to the listener groups that route needs.
 * Does not include `core` (always on).
 */
export function groupsForPathname(pathname: string): WorkspaceListenerGroup[] {
  const p = pathname || "/";
  const groups: WorkspaceListenerGroup[] = [];

  const isDashboard = p === "/dashboard" || p.startsWith("/dashboard/");
  const isLeads = p === "/leads" || p.startsWith("/leads/");
  const isProspects = p === "/prospects" || p.startsWith("/prospects/");
  const isLeadDetail = /^\/leads\/[^/]+$/.test(p);
  const isAccounts = p === "/accounts" || p.startsWith("/accounts/");
  const isAccountDetail = /^\/accounts\/[^/]+$/.test(p);
  const isContacts = p === "/contacts" || p.startsWith("/contacts/");
  const isDeals = p === "/deals" || p.startsWith("/deals/");
  const isOutreach = p === "/outreach" || p.startsWith("/outreach/");
  const isAdminCampaigns = p.startsWith("/admin/campaigns");
  const isAdminProfiles = p === "/admin/profiles" || p.startsWith("/admin/profiles/");
  const isInbox = p === "/inbox" || p.startsWith("/inbox/");
  const isFollowups = p === "/followups" || p.startsWith("/followups/");
  const isScheduling = p === "/scheduling" || p.startsWith("/scheduling/");
  const isPipeline = p === "/pipeline" || p.startsWith("/pipeline/");
  const isActivity = p === "/activity" || p.startsWith("/activity/");
  const isIntake = p === "/intake" || p.startsWith("/intake/");

  if (
    isLeads ||
    isProspects ||
    isInbox ||
    isAccounts ||
    isContacts ||
    isDeals ||
    isIntake
  ) {
    groups.push("directory");
  }

  if (isDashboard || isDeals || isPipeline || isAccountDetail || isLeadDetail) {
    groups.push("deals");
  }

  if (
    isFollowups ||
    isLeads ||
    isProspects ||
    isInbox ||
    isDashboard ||
    isScheduling
  ) {
    groups.push("plans");
  }

  // Capped timeline for dashboard activity feed and lead detail; notes/touchpoints stay on leadDetail only.
  if (isDashboard || isLeadDetail) {
    groups.push("timeline");
  }
  if (isLeadDetail) {
    groups.push("leadDetail");
  }

  if (isDashboard || isActivity || isAdminProfiles) {
    groups.push("activity");
  }

  if (isDashboard || isOutreach || isLeads || isProspects || isAdminCampaigns) {
    groups.push("campaigns");
  }

  return groups;
}

export function mergeWorkspaceGroups(
  ...sets: Array<Iterable<WorkspaceListenerGroup> | undefined>
): Set<WorkspaceListenerGroup> {
  const out = new Set<WorkspaceListenerGroup>(CORE_WORKSPACE_GROUPS);
  for (const set of sets) {
    if (!set) continue;
    for (const g of set) out.add(g);
  }
  return out;
}

export function workspaceGroupsKey(groups: ReadonlySet<WorkspaceListenerGroup>): string {
  return [...groups].sort().join(",");
}
