import type { Role } from "@/lib/types";

/** Shared rank table so can.ts and admin-feature-access avoid a circular import. */
const WORKSPACE_ROLE_RANK: Record<string, number> = {
  director: 40,
  manager: 30,
  team_lead: 20,
  salesperson: 10,
  data_scraper: 10,
  prospecting: 10,
  /** Below sales roles so legacy minWorkspaceRole gates never open pipeline for content. */
  content_team: 5,
};

/** Numeric CRM rank when known; `undefined` for custom / unknown role ids. */
export function crmRoleRank(roleId: Role | string | undefined): number | undefined {
  if (!roleId?.trim()) return undefined;
  const rank = WORKSPACE_ROLE_RANK[roleId];
  return typeof rank === "number" ? rank : undefined;
}

/**
 * Whether `target` should replace `current` (upgrade-only).
 * - Missing current → assign target.
 * - Custom/unknown current → never overwrite.
 * - Known ranks → only when target ranks strictly higher.
 */
export function shouldAssignHigherCrmRole(
  current: Role | string | undefined,
  target: Role | string | undefined,
): boolean {
  if (!target?.trim()) return false;
  if (!current?.trim()) return true;
  const have = crmRoleRank(current);
  const need = crmRoleRank(target);
  // Custom/unknown current: do not demote or overwrite.
  if (have === undefined) return false;
  // Unknown target cannot be ranked as an upgrade.
  if (need === undefined) return false;
  return need > have;
}

export function workspaceRoleMeetsMin(roleId: Role | undefined, min: Role): boolean {
  const role = roleId ?? "salesperson";
  const have = WORKSPACE_ROLE_RANK[role] ?? 10;
  const need = WORKSPACE_ROLE_RANK[min] ?? 10;
  return have >= need;
}
