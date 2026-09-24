import { shouldAssignHigherCrmRole } from "@/lib/permissions/admin-feature-access-rank";
import type { OrgMemberRole, Role } from "@/lib/types";

/** Default CRM permission role for a workspace access level. */
export function defaultCrmRoleIdForOrgRole(orgRole: OrgMemberRole): Role {
  switch (orgRole) {
    case "owner":
      return "director";
    case "admin":
    case "manager":
      return "manager";
    default:
      return "salesperson";
  }
}

/**
 * Whether CRM `roleId` should be upgraded to the default for `orgRole`.
 * Upgrade-only: never demotes director/custom/higher roles.
 */
export function shouldUpgradeCrmRoleForOrgRole(
  orgRole: OrgMemberRole,
  currentRoleId: Role | string | undefined,
): boolean {
  const target = defaultCrmRoleIdForOrgRole(orgRole);
  return shouldAssignHigherCrmRole(currentRoleId, target);
}

/**
 * Backfill / force sync: fill missing roles or upgrade when org role implies a higher CRM default.
 * Kept as a named alias for existing call sites.
 */
export function shouldUpgradeCrmRoleOnBackfill(
  orgRole: OrgMemberRole,
  currentRoleId: Role | undefined,
): boolean {
  return shouldUpgradeCrmRoleForOrgRole(orgRole, currentRoleId);
}
