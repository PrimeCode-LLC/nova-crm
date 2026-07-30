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
  /** Org-level Live activity rows (strategy, import, intake promote, …). */
  orgActivityEvents: "orgActivityEvents",
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
  /** ICP buyer personas for prospecting strategies (not outreach Profiles). */
  buyerPersonas: "buyerPersonas",
  /** Prospecting strategy / playbook guidance documents. */
  prospectingStrategies: "prospectingStrategies",
  /** User assignments to prospecting strategies. */
  strategyAssignments: "strategyAssignments",
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
  /** Durable bulk prospect import job summaries. */
  importJobs: "importJobs",
  /** Temporary normalized row chunks consumed by Firebase Functions. */
  importJobChunks: "importJobChunks",
  /** Tenant-scoped hashed email/domain/linkedin/phone identity reservations. */
  importIdentityKeys: "importIdentityKeys",
  /** RSS feed configs for social scraper (tenant-scoped). */
  scraperFeeds: "scraperFeeds",
  /** 7-day staging pool before promote to prospect/lead. */
  scraperRawItems: "scraperRawItems",
  auditLog: "auditLog",
  /** Append-only exception / request-failure log for admin debugging. */
  errorLogs: "errorLogs",
  workspaceChatChannels: "workspaceChatChannels",
  workspaceChatMessages: "workspaceChatMessages",
  /** Per-user last-read timestamps per channel (`channels.{channelId}` → ISO string). */
  workspaceChatReads: "workspaceChatReads",
  /** Durable in-app notifications targeted at a recipient (ownership, strategy, mentions, …). */
  userNotifications: "userNotifications",
  /** SaaS tenants - read/write only through server (Admin SDK). */
  organizations: "organizations",
  /** Product-level operators - read/write only through server (Admin SDK). */
  platformAdmins: "platformAdmins",
  /** Single-use PKCE authorization codes for the Nova browser extension. */
  extensionAuthCodes: "extensionAuthCodes",
  /** Hashed, revocable 24-hour browser-extension sessions. */
  extensionSessions: "extensionSessions",
  /** Fixed-window counters for extension authentication endpoints. */
  extensionAuthRateLimits: "extensionAuthRateLimits",
  /** Browser-extension discoveries and their Nova save attribution. */
  extensionFindings: "extensionFindings",
  /** Durable prospect drafts; users may own multiple active manual drafts. */
  prospectDrafts: "prospectDrafts",
  /** Full captured sources kept outside draft summaries to avoid document-size growth. */
  prospectDraftSources: "prospectDraftSources",
  /** Legacy extension pointers to each user's current working draft. */
  prospectDraftLocks: "prospectDraftLocks",
  /** Transactional email and per-company reservations used while completing drafts. */
  prospectDraftReservations: "prospectDraftReservations",
  /** Content calendar brands (personal / company social voices). */
  contentBrands: "contentBrands",
  /** Calendar posts / slots. */
  contentItems: "contentItems",
  /** Daily problem→solution captures feeding RAG. */
  contentCaptures: "contentCaptures",
  /** Batch plan jobs for fill-next-N-days. */
  contentPlans: "contentPlans",
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
  /** Org-scoped CRM Role Catalog (`WorkspaceRoleDoc`). */
  roles: "roles",
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
  COLLECTIONS.orgActivityEvents,
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
  COLLECTIONS.buyerPersonas,
  COLLECTIONS.prospectingStrategies,
  COLLECTIONS.strategyAssignments,
  COLLECTIONS.schedulingLinks,
  COLLECTIONS.meetings,
  COLLECTIONS.availabilitySchedules,
  COLLECTIONS.calendarDelegations,
  COLLECTIONS.mailboxDelegations,
  COLLECTIONS.calendarConnections,
  COLLECTIONS.importJobs,
  COLLECTIONS.importJobChunks,
  COLLECTIONS.importIdentityKeys,
  COLLECTIONS.auditLog,
  COLLECTIONS.errorLogs,
  COLLECTIONS.workspaceChatChannels,
  COLLECTIONS.workspaceChatMessages,
  COLLECTIONS.workspaceChatReads,
  COLLECTIONS.userNotifications,
  COLLECTIONS.prospectDrafts,
  COLLECTIONS.prospectDraftSources,
  COLLECTIONS.prospectDraftLocks,
  COLLECTIONS.prospectDraftReservations,
  COLLECTIONS.contentBrands,
  COLLECTIONS.contentItems,
  COLLECTIONS.contentCaptures,
  COLLECTIONS.contentPlans,
] as const;
