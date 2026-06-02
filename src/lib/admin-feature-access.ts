import type { AdminFeatureKey } from "@/lib/admin-features";
import { ADMIN_FEATURES } from "@/lib/admin-features";
import type { OrgMemberRole, Role, User } from "@/lib/types";
import { roleAtLeast } from "@/lib/platform/org-role";

const WORKSPACE_ROLE_RANK: Record<Role, number> = {
  director: 40,
  manager: 30,
  team_lead: 20,
  salesperson: 10,
  data_scraper: 10,
  prospecting: 10,
};

export type AdminFeatureAccessInput = Pick<
  User,
  "roleId" | "isSuperAdmin" | "featureGrants"
> & {
  orgRole?: OrgMemberRole;
};

export function workspaceRoleMeetsMin(roleId: Role | undefined, min: Role): boolean {
  const role = roleId ?? "salesperson";
  return WORKSPACE_ROLE_RANK[role] >= WORKSPACE_ROLE_RANK[min];
}

/**
 * Whether a user may use an admin feature — via CRM role, org role, explicit grant, or super admin.
 */
export function userHasAdminFeature(
  user: AdminFeatureAccessInput | undefined,
  feature: AdminFeatureKey,
  orgRole?: OrgMemberRole,
): boolean {
  if (!user) return false;
  if (user.isSuperAdmin) return true;

  const meta = ADMIN_FEATURES[feature];
  const effectiveOrgRole = orgRole ?? user.orgRole;

  if (meta.minOrgRole && effectiveOrgRole && roleAtLeast(effectiveOrgRole, meta.minOrgRole)) {
    return true;
  }
  if (meta.minWorkspaceRole && workspaceRoleMeetsMin(user.roleId, meta.minWorkspaceRole)) {
    return true;
  }
  if (user.featureGrants?.includes(feature)) {
    return true;
  }

  if (!meta.minWorkspaceRole && !meta.minOrgRole) {
    return true;
  }

  return false;
}

export function normalizeFeatureGrants(
  grants: unknown,
): AdminFeatureKey[] | undefined {
  if (!Array.isArray(grants)) return undefined;
  const valid = new Set(Object.keys(ADMIN_FEATURES) as AdminFeatureKey[]);
  const out = grants.filter((g): g is AdminFeatureKey => typeof g === "string" && valid.has(g as AdminFeatureKey));
  return out.length ? [...new Set(out)] : undefined;
}
