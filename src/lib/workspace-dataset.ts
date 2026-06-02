import type {
  User,
  Department,
  Account,
  Contact,
  Lead,
  Deal,
  Touchpoint,
  TimelineEvent,
  Followup,
  FollowupPlan,
  LeadTask,
  Note,
  Profile,
  Campaign,
  ActivityCounterRow,
  ActivityRecord,
  PermissionOverride,
  CrmLabel,
} from "./types";
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
import type { WorkspaceMode } from "./workspace-mode";
import { parseDemoPersonaId } from "./demo-persona";
import { filterLeadTasksForViewer } from "./lead-task-visibility";
import {
  activityActorUserIdsVisibleToViewer,
  followupVisibleInHierarchyScope,
} from "./workspace-hierarchy";

export type WorkspaceSnapshot = {
  users: User[];
  departments: Department[];
  permissionOverrides: PermissionOverride[];
  profiles: Profile[];
  campaigns: Campaign[];
  accounts: Account[];
  contacts: Contact[];
  leads: Lead[];
  deals: Deal[];
  touchpoints: Touchpoint[];
  timelineByLead: Record<string, TimelineEvent[]>;
  followups: Followup[];
  followupPlans: FollowupPlan[];
  leadTasks: LeadTask[];
  notes: Note[];
  activityCounters: ActivityCounterRow[];
  activityRecords: ActivityRecord[];
  crmLabels: CrmLabel[];
  currentUserId: string;
};

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

const EMPTY_TIMELINE: Record<string, TimelineEvent[]> = {};

export const LIVE_SNAPSHOT: WorkspaceSnapshot = {
  users: [],
  departments: [],
  permissionOverrides: [],
  profiles: [],
  campaigns: [],
  accounts: [],
  contacts: [],
  leads: [],
  deals: [],
  touchpoints: [],
  timelineByLead: EMPTY_TIMELINE,
  followups: [],
  followupPlans: [],
  leadTasks: [],
  notes: [],
  activityCounters: [],
  activityRecords: [],
  crmLabels: [],
  currentUserId: "",
};

/** Users managed under `rootManagerId` (not including `rootManagerId`). */
function collectDescendantUserIds(rootManagerId: string, users: readonly User[]): Set<string> {
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

/**
 * User IDs this persona can see in directory / admin pickers.
 * `null` = entire org (director).
 */
function directoryUserIdsFor(persona: User, allUsers: readonly User[]): Set<string> | null {
  if (persona.roleId === "director") return null;
  if (persona.roleId === "manager") {
    const s = new Set<string>([persona.id]);
    for (const id of collectDescendantUserIds(persona.id, allUsers)) s.add(id);
    return s;
  }
  if (persona.departmentId) {
    return new Set(allUsers.filter((u) => u.departmentId === persona.departmentId).map((u) => u.id));
  }
  return new Set([persona.id]);
}

/** Whether a demo lead is visible to the active persona (org + ownership rules). */
function leadVisibleForPersona(lead: Lead, persona: User, allUsers: readonly User[]): boolean {
  // Intake prospects are treated as an org-wide pool in demo so every tour persona sees sample rows.
  if (lead.intakeKind === "prospect") return true;
  if (persona.roleId === "director") return true;
  if (persona.roleId === "manager") {
    const owners = new Set<string>([persona.id]);
    for (const id of collectDescendantUserIds(persona.id, allUsers)) owners.add(id);
    return owners.has(lead.ownerId);
  }
  // Chris (Senior SDR): mock permission grant, read leads for full Outbound department.
  if (persona.id === "u-sales-01") {
    return allUsers.some((u) => u.id === lead.ownerId && u.departmentId === "d-outbound");
  }
  if (persona.roleId === "prospecting" || persona.roleId === "data_scraper") {
    return lead.ownerId === persona.id || lead.scraperId === persona.id;
  }
  return lead.ownerId === persona.id;
}

/**
 * Narrows demo mock data to what this persona would realistically see (so switching sample users changes lists, pipeline, inbox, etc.).
 */
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

  const leadTasks = filterLeadTasksForViewer(snapshot.leadTasks, persona);

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

export function getWorkspaceSnapshot(
  mode: WorkspaceMode,
  demoPersonaId?: string,
): WorkspaceSnapshot {
  if (mode === "demo") {
    const id = parseDemoPersonaId(demoPersonaId);
    const snapshot = { ...DEMO_SNAPSHOT, currentUserId: id };
    return applyDemoPersonaScope(snapshot);
  }
  return LIVE_SNAPSHOT;
}

export type WorkspaceLookup = {
  getLeadById: (id: string) => Lead | undefined;
  getContactById: (id: string) => Contact | undefined;
  getAccountById: (id: string) => Account | undefined;
  getUserById: (id: string) => User | undefined;
  getProfileById: (id?: string) => Profile | undefined;
  getCampaignById: (id?: string) => Campaign | undefined;
};

export function createWorkspaceLookup(snapshot: WorkspaceSnapshot): WorkspaceLookup {
  return {
    getLeadById: (id) => snapshot.leads.find((l) => l.id === id),
    getContactById: (id) => snapshot.contacts.find((c) => c.id === id),
    getAccountById: (id) => snapshot.accounts.find((a) => a.id === id),
    getUserById: (id) => snapshot.users.find((u) => u.id === id),
    getProfileById: (id) => (id ? snapshot.profiles.find((p) => p.id === id) : undefined),
    getCampaignById: (id) => (id ? snapshot.campaigns.find((c) => c.id === id) : undefined),
  };
}
