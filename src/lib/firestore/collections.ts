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
