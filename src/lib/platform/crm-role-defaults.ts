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

/** Whether an existing CRM profile should be upgraded during backfill. */
export function shouldUpgradeCrmRoleOnBackfill(
  orgRole: OrgMemberRole,
  currentRoleId: Role | undefined,
): boolean {
  if (!currentRoleId) return true;
  if (orgRole === "owner" && currentRoleId === "salesperson") return true;
  return false;
}
