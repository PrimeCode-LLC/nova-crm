import type { User } from "./types";

function titleIndicatesFounder(title: string): boolean {
  const t = title.toLowerCase();
  return t.includes("founder") || t.includes("co-founder");
}

/** Directors, explicit super-admins, and founder-titled users may manage org users (invite/edit). */
export function canManageOrgUsers(viewer: User | undefined): boolean {
  if (!viewer) return false;
  if (viewer.isSuperAdmin) return true;
  if (viewer.roleId === "director") return true;
  if (titleIndicatesFounder(viewer.title ?? "")) return true;
  return false;
}

/** Who may change reporting lines / CRM workspace fields for other users (demo + live API). */
export function canManageOrgHierarchy(viewer: User | undefined): boolean {
  if (!viewer) return false;
  if (canManageOrgUsers(viewer)) return true;
  if (viewer.orgRole === "owner" || viewer.orgRole === "admin") return true;
  return false;
}
