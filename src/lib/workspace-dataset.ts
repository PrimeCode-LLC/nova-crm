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
  Note,
  Profile,
  Campaign,
  ActivityCounterRow,
  ActivityRecord,
  PermissionOverride,
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
  mockNotes,
  mockActivityCounters,
  mockActivityRecords,
  CURRENT_USER_ID,
} from "./mock-data";
import type { WorkspaceMode } from "./workspace-mode";
import { parseDemoPersonaId } from "./demo-persona";

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
  notes: Note[];
  activityCounters: ActivityCounterRow[];
  activityRecords: ActivityRecord[];
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
  notes: mockNotes,
  activityCounters: mockActivityCounters,
  activityRecords: mockActivityRecords,
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
  notes: [],
  activityCounters: [],
  activityRecords: [],
  currentUserId: "",
};

export function getWorkspaceSnapshot(
  mode: WorkspaceMode,
  demoPersonaId?: string,
): WorkspaceSnapshot {
  if (mode === "demo") {
    const id = parseDemoPersonaId(demoPersonaId);
    return { ...DEMO_SNAPSHOT, currentUserId: id };
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
