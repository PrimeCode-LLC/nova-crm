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
