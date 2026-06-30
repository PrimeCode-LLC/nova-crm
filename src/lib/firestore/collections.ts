/** Firestore top-level collection ids (flat layout v1). */
export const COLLECTIONS = {
  users: "users",
  computedPermissions: "computedPermissions",
  leads: "leads",
  notes: "notes",
  followups: "followups",
  followupPlans: "followupPlans",
  leadTasks: "leadTasks",
  touchpoints: "touchpoints",
  timelineEvents: "timelineEvents",
  accounts: "accounts",
  contacts: "contacts",
  deals: "deals",
  departments: "departments",
  permissionOverrides: "permissionOverrides",
  activityCounters: "activityCounters",
  activityRecords: "activityRecords",
  profiles: "profiles",
  campaigns: "campaigns",
  scriptLibrary: "scriptLibrary",
  /** Workspace-defined labels for leads, deals, accounts, contacts. */
  labels: "labels",
  /** Scheduling links (Calendly-style event types). */
  schedulingLinks: "schedulingLinks",
  /** Booked sales meetings tied to leads and hosts. */
  meetings: "meetings",
  /** Per-user weekly availability schedules. */
  availabilitySchedules: "availabilitySchedules",
  /** Explicit grants for booking on another member's calendar. */
  calendarDelegations: "calendarDelegations",
  /** Explicit grants for viewing/sending from another member's mailbox. */
  mailboxDelegations: "mailboxDelegations",
  /** Connected Google / Microsoft calendars per user (tokens server-only). */
  calendarConnections: "calendarConnections",
  ingestQueue: "ingestQueue",
  /** RSS feed configs for social scraper (tenant-scoped). */
  scraperFeeds: "scraperFeeds",
  /** 7-day staging pool before promote to prospect/lead. */
  scraperRawItems: "scraperRawItems",
  auditLog: "auditLog",
  workspaceChatChannels: "workspaceChatChannels",
  workspaceChatMessages: "workspaceChatMessages",
  /** Per-user last-read timestamps per channel (`channels.{channelId}` → ISO string). */
  workspaceChatReads: "workspaceChatReads",
  /** SaaS tenants — read/write only through server (Admin SDK). */
  organizations: "organizations",
  /** Product-level operators — read/write only through server (Admin SDK). */
  platformAdmins: "platformAdmins",
} as const;

/** Subcollections under `organizations/{orgId}/*` (server-managed). */
export const ORG_SUBCOLLECTIONS = {
  members: "members",
  invites: "invites",
  audit: "audit",
  aiSettings: "aiSettings",
  aiProviderSecrets: "aiProviderSecrets",
  aiPrompts: "aiPrompts",
  aiLibraries: "aiLibraries",
  aiDocuments: "aiDocuments",
  aiUsageDaily: "aiUsageDaily",
  aiUsageEvents: "aiUsageEvents",
  aiCache: "aiCache",
  /** Saved dashboard AI brief generations (trimmed to last N per org). */
  aiBriefHistory: "aiBriefHistory",
  /** Opportunity fit check scans (paste → match analysis). */
  opportunityScans: "opportunityScans",
  /** Encrypted third-party integration credentials (Instantly, etc.). */
  integrationSecrets: "integrationSecrets",
} as const;

/**
 * CRM collections that store tenant data. Every document in these MUST carry
 * `organizationId` so security rules and queries can filter by tenant.
 */
export const TENANT_COLLECTIONS = [
  COLLECTIONS.leads,
  COLLECTIONS.notes,
  COLLECTIONS.followups,
  COLLECTIONS.followupPlans,
  COLLECTIONS.leadTasks,
  COLLECTIONS.touchpoints,
  COLLECTIONS.timelineEvents,
  COLLECTIONS.accounts,
  COLLECTIONS.contacts,
  COLLECTIONS.deals,
  COLLECTIONS.departments,
  COLLECTIONS.permissionOverrides,
  COLLECTIONS.activityCounters,
  COLLECTIONS.activityRecords,
  COLLECTIONS.profiles,
  COLLECTIONS.campaigns,
  COLLECTIONS.scriptLibrary,
  COLLECTIONS.labels,
  COLLECTIONS.schedulingLinks,
  COLLECTIONS.meetings,
  COLLECTIONS.availabilitySchedules,
  COLLECTIONS.calendarDelegations,
  COLLECTIONS.mailboxDelegations,
  COLLECTIONS.calendarConnections,
  COLLECTIONS.auditLog,
  COLLECTIONS.workspaceChatChannels,
  COLLECTIONS.workspaceChatMessages,
  COLLECTIONS.workspaceChatReads,
] as const;
