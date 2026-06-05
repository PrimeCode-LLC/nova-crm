import type { Lead, TimelineEvent, User } from "./types";
import {
  mockUsers,
  mockDepartments,
  mockPermissionOverrides,
  mockProfiles,
  mockCampaigns,
  mockAccounts,
  mockContacts,
  mockLeads,
  mockDeals,
  mockTouchpoints,
  mockTimelineByLead,
  mockFollowups,
  mockLeadTasks,
  mockNotes,
  mockActivityCounters,
  mockActivityRecords,
  mockCrmLabels,
  CURRENT_USER_ID,
} from "./mock-data";
import { parseDemoPersonaId } from "./demo-persona";
import { filterLeadTasksForViewer } from "./lead-task-visibility";
import {
  activityActorUserIdsVisibleToViewer,
  collectDescendantUserIds,
  followupVisibleInHierarchyScope,
} from "./workspace-hierarchy";
import type { WorkspaceSnapshot } from "./workspace-dataset-core";

export const DEMO_SNAPSHOT: WorkspaceSnapshot = {
  users: mockUsers,
  departments: mockDepartments,
  permissionOverrides: mockPermissionOverrides,
  profiles: mockProfiles,
  campaigns: mockCampaigns,
  accounts: mockAccounts,
  contacts: mockContacts,
  leads: mockLeads,
  deals: mockDeals,
  touchpoints: mockTouchpoints,
  timelineByLead: mockTimelineByLead,
  followups: mockFollowups,
  followupPlans: [],
  leadTasks: mockLeadTasks,
  notes: mockNotes,
  activityCounters: mockActivityCounters,
  activityRecords: mockActivityRecords,
  crmLabels: mockCrmLabels,
  currentUserId: CURRENT_USER_ID,
};

function directoryUserIdsFor(persona: User, allUsers: readonly User[]): Set<string> | null {
  if (persona.roleId === "director") return null;
  const descendants = collectDescendantUserIds(persona.id, allUsers);
  if (persona.roleId === "manager" || descendants.size > 0) {
    const s = new Set<string>([persona.id]);
    for (const id of descendants) s.add(id);
    return s;
  }
  if (persona.departmentId) {
    return new Set(allUsers.filter((u) => u.departmentId === persona.departmentId).map((u) => u.id));
  }
  return new Set([persona.id]);
}

function leadVisibleForPersona(lead: Lead, persona: User, allUsers: readonly User[]): boolean {
  if (lead.intakeKind === "prospect") return true;
  if (persona.roleId === "director") return true;
  const descendants = collectDescendantUserIds(persona.id, allUsers);
  if (persona.roleId === "manager" || descendants.size > 0) {
    const owners = new Set<string>([persona.id]);
    for (const id of descendants) owners.add(id);
    return owners.has(lead.ownerId);
  }
  if (persona.id === "u-sales-01") {
    return allUsers.some((u) => u.id === lead.ownerId && u.departmentId === "d-outbound");
  }
  if (persona.roleId === "prospecting" || persona.roleId === "data_scraper") {
    return lead.ownerId === persona.id || lead.scraperId === persona.id;
  }
  return lead.ownerId === persona.id;
}

function applyDemoPersonaScope(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const persona = mockUsers.find((u) => u.id === snapshot.currentUserId);
  if (!persona || persona.roleId === "director") {
    return snapshot;
  }

  const dirIds = directoryUserIdsFor(persona, mockUsers);
  const users = dirIds === null ? snapshot.users : snapshot.users.filter((u) => dirIds.has(u.id));

  const leads = snapshot.leads.filter((l) => leadVisibleForPersona(l, persona, mockUsers));
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

  const activityActorIds = activityActorUserIdsVisibleToViewer(persona, mockUsers);
  const standaloneActorIds = activityActorIds ?? new Set(users.map((u) => u.id));

  const followups = snapshot.followups.filter((f) =>
    followupVisibleInHierarchyScope(f, visibleLeadIds, visibleDealIds, standaloneActorIds),
  );

  const followupPlans = (snapshot.followupPlans ?? []).filter((p) => visibleLeadIds.has(p.leadId));

  const leadTasks = filterLeadTasksForViewer(snapshot.leadTasks, persona, mockUsers);

  const notes = snapshot.notes.filter((n) => n.leadId && visibleLeadIds.has(n.leadId));

  const profiles =
    dirIds === null ? snapshot.profiles : snapshot.profiles.filter((p) => dirIds.has(p.ownerId));

  const permissionOverrides =
    dirIds === null
      ? snapshot.permissionOverrides
      : snapshot.permissionOverrides.filter((po) => dirIds.has(po.userId));
  const activityCounters =
    activityActorIds === null
      ? snapshot.activityCounters
      : snapshot.activityCounters.filter((row) => activityActorIds.has(row.userId));

  const activityRecords =
    activityActorIds === null
      ? snapshot.activityRecords
      : snapshot.activityRecords.filter(
          (r) => activityActorIds.has(r.userId) && (!r.leadId || visibleLeadIds.has(r.leadId)),
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
    followupPlans,
    leadTasks,
    notes,
    profiles,
    permissionOverrides,
    activityCounters,
    activityRecords,
  };
}

export function getWorkspaceSnapshotDemo(demoPersonaId?: string): WorkspaceSnapshot {
  const id = parseDemoPersonaId(demoPersonaId);
  const snapshot = { ...DEMO_SNAPSHOT, currentUserId: id };
  return applyDemoPersonaScope(snapshot);
}
