/** Firestore top-level collection ids (flat layout v1). */
export const COLLECTIONS = {
  users: "users",
  computedPermissions: "computedPermissions",
  leads: "leads",
  accounts: "accounts",
  contacts: "contacts",
  deals: "deals",
  departments: "departments",
  permissionOverrides: "permissionOverrides",
  activityCounters: "activityCounters",
  activityRecords: "activityRecords",
  ingestQueue: "ingestQueue",
  auditLog: "auditLog",
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
} as const;

/**
 * CRM collections that store tenant data. Every document in these MUST carry
 * `organizationId` so security rules and queries can filter by tenant.
 */
export const TENANT_COLLECTIONS = [
  COLLECTIONS.leads,
  COLLECTIONS.accounts,
  COLLECTIONS.contacts,
  COLLECTIONS.deals,
  COLLECTIONS.departments,
  COLLECTIONS.permissionOverrides,
  COLLECTIONS.activityCounters,
  COLLECTIONS.activityRecords,
  COLLECTIONS.auditLog,
] as const;
