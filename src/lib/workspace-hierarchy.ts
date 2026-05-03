import type { User, Lead, TimelineEvent } from "./types";
import type { WorkspaceSnapshot } from "./workspace-dataset";

/** Direct reports (recursive), excluding the root id. */
export function collectDescendantUserIds(
  rootManagerId: string,
  users: readonly User[],
): Set<string> {
  const ids = new Set<string>();
  const queue = [rootManagerId];
  while (queue.length) {
    const mid = queue.shift()!;
    for (const u of users) {
      if (u.managerId === mid && !ids.has(u.id)) {
        ids.add(u.id);
        queue.push(u.id);
      }
    }
  }
  return ids;
}

function seesAllLeadsInTenant(viewer: User): boolean {
  if (viewer.roleId === "director") return true;
  if (viewer.isSuperAdmin) return true;
  if (viewer.orgRole === "owner" || viewer.orgRole === "admin") return true;
  return false;
}

/** Whether `lead` should appear for `viewer` given the org roster (live workspace). */
export function leadVisibleForLiveViewer(
  lead: Lead,
  viewer: User,
  orgUsers: readonly User[],
): boolean {
  if (seesAllLeadsInTenant(viewer)) return true;

  if (viewer.roleId === "manager" || viewer.roleId === "team_lead") {
    const owners = new Set<string>([viewer.id]);
    for (const id of collectDescendantUserIds(viewer.id, orgUsers)) owners.add(id);
    return owners.has(lead.ownerId);
  }

  if (viewer.departmentId) {
    const deptOwnerIds = new Set(
      orgUsers.filter((u) => u.departmentId === viewer.departmentId).map((u) => u.id),
    );
    return deptOwnerIds.has(lead.ownerId);
  }

  if (viewer.roleId === "data_scraper") {
    return lead.ownerId === viewer.id || lead.scraperId === viewer.id;
  }

  return lead.ownerId === viewer.id;
}

function directoryUserIdsForLive(viewer: User, orgUsers: readonly User[]): Set<string> | null {
  if (seesAllLeadsInTenant(viewer)) return null;
  if (viewer.roleId === "manager" || viewer.roleId === "team_lead") {
    const s = new Set<string>([viewer.id]);
    for (const id of collectDescendantUserIds(viewer.id, orgUsers)) s.add(id);
    return s;
  }
  if (viewer.departmentId) {
    return new Set(orgUsers.filter((u) => u.departmentId === viewer.departmentId).map((u) => u.id));
  }
  return new Set([viewer.id]);
}

/**
 * Applies org-chart style visibility to a loaded tenant snapshot (live Firestore data).
 * Directors and workspace owner/admin see the full org; managers/team leads see their subtree;
 * same-department members see each other's pipeline when departmentId is set; otherwise own rows only.
 */
export function applyLiveHierarchyScope(
  snapshot: WorkspaceSnapshot,
  viewer: User,
  orgUsers: readonly User[],
): WorkspaceSnapshot {
  if (seesAllLeadsInTenant(viewer)) {
    return snapshot;
  }

  const dirIds = directoryUserIdsForLive(viewer, orgUsers);
  const users = dirIds === null ? snapshot.users : snapshot.users.filter((u) => dirIds.has(u.id));

  const leads = snapshot.leads.filter((l) => leadVisibleForLiveViewer(l, viewer, orgUsers));
  const visibleLeadIds = new Set(leads.map((l) => l.id));
  const visibleAccountIds = new Set(leads.map((l) => l.accountId));

  const deals = snapshot.deals.filter((d) => visibleLeadIds.has(d.leadId));
  const visibleDealIds = new Set(deals.map((d) => d.id));

  const accounts = snapshot.accounts.filter((a) => visibleAccountIds.has(a.id));
  const contacts = snapshot.contacts.filter((c) => visibleAccountIds.has(c.accountId));

  const touchpoints = snapshot.touchpoints.filter((t) => visibleLeadIds.has(t.leadId));

  const timelineByLead: Record<string, TimelineEvent[]> = {};
  for (const id of visibleLeadIds) {
    const te = snapshot.timelineByLead[id];
    if (te) timelineByLead[id] = te;
  }

  const followups = snapshot.followups.filter(
    (f) =>
      (f.leadId != null && visibleLeadIds.has(f.leadId)) ||
      (f.dealId != null && visibleDealIds.has(f.dealId)),
  );

  const notes = snapshot.notes.filter((n) => n.leadId && visibleLeadIds.has(n.leadId));

  const profiles =
    dirIds === null ? snapshot.profiles : snapshot.profiles.filter((p) => dirIds.has(p.ownerId));

  const permissionOverrides =
    dirIds === null
      ? snapshot.permissionOverrides
      : snapshot.permissionOverrides.filter((po) => dirIds.has(po.userId));

  const activityCounters =
    dirIds === null
      ? snapshot.activityCounters
      : snapshot.activityCounters.filter((row) => dirIds.has(row.userId));

  const activityRecords =
    dirIds === null
      ? snapshot.activityRecords
      : snapshot.activityRecords.filter(
          (r) => dirIds.has(r.userId) && (!r.leadId || visibleLeadIds.has(r.leadId)),
        );

  return {
    ...snapshot,
    users,
    leads,
    deals,
    accounts,
    contacts,
    touchpoints,
    timelineByLead,
    followups,
    notes,
    profiles,
    permissionOverrides,
    activityCounters,
    activityRecords,
  };
}
