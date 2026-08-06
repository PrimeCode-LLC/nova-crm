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
  OrgActivityEvent,
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
  orgActivityEvents: OrgActivityEvent[];
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
  orgActivityEvents: [],
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
  const leadsById = new Map(snapshot.leads.map((l) => [l.id, l]));
  const contactsById = new Map(snapshot.contacts.map((c) => [c.id, c]));
  const accountsById = new Map(snapshot.accounts.map((a) => [a.id, a]));
  const usersById = new Map(snapshot.users.map((u) => [u.id, u]));
  const profilesById = new Map(snapshot.profiles.map((p) => [p.id, p]));
  const campaignsById = new Map(snapshot.campaigns.map((c) => [c.id, c]));

  return {
    getLeadById: (id) => leadsById.get(id),
    getContactById: (id) => contactsById.get(id),
    getAccountById: (id) => accountsById.get(id),
    getUserById: (id) => usersById.get(id),
    getProfileById: (id) => (id ? profilesById.get(id) : undefined),
    getCampaignById: (id) => (id ? campaignsById.get(id) : undefined),
  };
}
