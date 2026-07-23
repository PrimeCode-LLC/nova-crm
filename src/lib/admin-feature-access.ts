import type { AdminFeatureKey } from "@/lib/admin-features";
import { ADMIN_FEATURES } from "@/lib/admin-features";
import { canAdminFeature } from "@/lib/permissions/can";
import { workspaceRoleMeetsMin } from "@/lib/permissions/admin-feature-access-rank";
import type { OrgMemberRole, User } from "@/lib/types";

export { workspaceRoleMeetsMin };

export type AdminFeatureAccessInput = Pick<
  User,
  "roleId" | "isSuperAdmin" | "featureGrants"
> & {
  orgRole?: OrgMemberRole;
  roleSnapshot?:
    | import("@/lib/permissions/role-types").EffectivePermissionSnapshot
    | import("@/lib/permissions/role-types").WorkspaceRoleDoc
    | null;
};

/**
 * Whether a user may use an admin feature - via role catalog, CRM/org role,
 * explicit grant, or super admin.
 */
export function userHasAdminFeature(
  user: AdminFeatureAccessInput | undefined,
  feature: AdminFeatureKey,
  orgRole?: OrgMemberRole,
): boolean {
  return canAdminFeature(user, feature, orgRole);
}

/** Whether the user may create Instantly outreach campaigns (manager+ org role or explicit grant). */
export function userCanCreateCampaigns(
  user: AdminFeatureAccessInput | undefined,
  orgRole?: OrgMemberRole,
): boolean {
  return userHasAdminFeature(user, "create_campaigns", orgRole);
}

/** Whether the user may delete intake pool posts (org admin+ or explicit grant). */
export function userCanDeleteIntakePool(
  user: AdminFeatureAccessInput | undefined,
  orgRole?: OrgMemberRole,
): boolean {
  return userHasAdminFeature(user, "delete_intake_pool", orgRole);
}

export function normalizeFeatureGrants(
  grants: unknown,
): AdminFeatureKey[] | undefined {
  if (!Array.isArray(grants)) return undefined;
  const valid = new Set(Object.keys(ADMIN_FEATURES) as AdminFeatureKey[]);
  const out = grants.filter(
    (g): g is AdminFeatureKey => typeof g === "string" && valid.has(g as AdminFeatureKey),
  );
  return out.length ? [...new Set(out)] : undefined;
}
