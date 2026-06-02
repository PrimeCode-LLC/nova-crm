import { canManageOrgHierarchy } from "@/lib/can-manage-org-users";
import type { User } from "@/lib/types";

/** Who may assign per-user admin feature grants. */
export function canManageFeatureGrants(viewer: User | undefined): boolean {
  return canManageOrgHierarchy(viewer);
}
