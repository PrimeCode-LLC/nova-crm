import type { User } from "./types";

/** Owner, admin, CRM director, or platform super-admin — can manage cross-user workspace rows where the app allows it. */
export function viewerHasElevatedWorkspaceRole(u: User | undefined): boolean {
  if (!u) return false;
  if (u.isSuperAdmin) return true;
  if (u.orgRole === "owner" || u.orgRole === "admin") return true;
  if (u.roleId === "director") return true;
  return false;
}
