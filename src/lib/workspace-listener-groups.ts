/**
 * Named Firestore listener groups for route-scoped subscriptions.
 * Groups attach on first need; non-core groups expire after a grace period
 * off-route so long sessions do not accumulate every listener forever.
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
 * Non-core groups that may be detached after {@link LISTENER_GROUP_GRACE_MS}
 * without being needed by the current route (or an explicit request).
 */
export const DETACHABLE_WORKSPACE_GROUPS: ReadonlySet<WorkspaceListenerGroup> = new Set([
  "directory",
  "deals",
  "plans",
  "timeline",
  "leadDetail",
  "activity",
  "campaigns",
]);

/** Keep listeners warm through quick back-and-forth navigation (re-subscribe re-reads). */
export const LISTENER_GROUP_GRACE_MS = 5 * 60_000;

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
  const isArchive = p === "/archive" || p.startsWith("/archive/");
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
    isArchive ||
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
    isArchive ||
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

  if (
    isDashboard ||
    isOutreach ||
    isLeads ||
    isProspects ||
    isArchive ||
    isAdminCampaigns
  ) {
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

/**
 * Drop detachable groups whose last-needed timestamp is older than the grace window
 * and that are not in `stillNeeded`. Always keeps `core`.
 */
export function expireUnusedWorkspaceGroups(input: {
  current: ReadonlySet<WorkspaceListenerGroup>;
  lastNeededAt: ReadonlyMap<WorkspaceListenerGroup, number>;
  stillNeeded: ReadonlySet<WorkspaceListenerGroup>;
  now: number;
  graceMs?: number;
}): Set<WorkspaceListenerGroup> {
  const graceMs = input.graceMs ?? LISTENER_GROUP_GRACE_MS;
  const next = new Set<WorkspaceListenerGroup>(CORE_WORKSPACE_GROUPS);
  for (const g of input.current) {
    if (g === "core") continue;
    if (input.stillNeeded.has(g)) {
      next.add(g);
      continue;
    }
    if (!DETACHABLE_WORKSPACE_GROUPS.has(g)) {
      next.add(g);
      continue;
    }
    const last = input.lastNeededAt.get(g);
    if (last === undefined || input.now - last < graceMs) {
      next.add(g);
    }
  }
  return next;
}
