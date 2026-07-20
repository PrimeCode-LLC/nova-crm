import type { Role } from "@/lib/types";

/** Shared rank table so can.ts and admin-feature-access avoid a circular import. */
const WORKSPACE_ROLE_RANK: Record<string, number> = {
  director: 40,
  manager: 30,
  team_lead: 20,
  salesperson: 10,
  data_scraper: 10,
  prospecting: 10,
};

export function workspaceRoleMeetsMin(roleId: Role | undefined, min: Role): boolean {
  const role = roleId ?? "salesperson";
  const have = WORKSPACE_ROLE_RANK[role] ?? 10;
  const need = WORKSPACE_ROLE_RANK[min] ?? 10;
  return have >= need;
}
