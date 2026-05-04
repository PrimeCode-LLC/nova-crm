import type { OrgMemberRole } from "@/lib/types";

const ROLE_ORDER: Record<OrgMemberRole, number> = {
  owner: 4,
  admin: 3,
  manager: 2,
  member: 1,
};

/** Safe for client bundles (no server-only imports). */
export function roleAtLeast(have: OrgMemberRole, need: OrgMemberRole): boolean {
  return ROLE_ORDER[have] >= ROLE_ORDER[need];
}
