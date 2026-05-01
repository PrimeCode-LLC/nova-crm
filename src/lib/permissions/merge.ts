import type { PermissionOverride, Role } from "@/lib/types";

export type ResourceKey = PermissionOverride["resource"];
export type ActionKey = PermissionOverride["action"];
export type ScopeKey = PermissionOverride["scope"];

/** Default scope by role before department / overrides (v1 heuristic). */
const ROLE_DEFAULT_SCOPE: Record<
  Role,
  Partial<Record<ResourceKey, ScopeKey>>
> = {
  director: {
    leads: "all",
    deals: "all",
    accounts: "all",
    contacts: "all",
    activities: "all",
  },
  manager: {
    leads: "department",
    deals: "department",
    accounts: "department",
    contacts: "department",
    activities: "department",
  },
  team_lead: {
    leads: "team",
    deals: "team",
    accounts: "team",
    contacts: "team",
    activities: "team",
  },
  salesperson: {
    leads: "own",
    deals: "own",
    accounts: "own",
    contacts: "own",
    activities: "own",
  },
  data_scraper: {
    leads: "own",
    deals: "own",
    accounts: "own",
    contacts: "own",
    activities: "own",
  },
};

const SCOPE_RANK: Record<ScopeKey, number> = {
  own: 0,
  team: 1,
  department: 2,
  custom: 3,
  all: 4,
};

function maxScope(a: ScopeKey, b: ScopeKey): ScopeKey {
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

export type EffectivePermission = {
  resource: ResourceKey;
  action: ActionKey;
  scope: ScopeKey;
};

/**
 * Merges role defaults with per-user overrides. Deny wins over grant at the same resource+action.
 * Department-based rules are applied upstream (same shape as an override with scope).
 */
export function mergePermissions(
  role: Role,
  overrides: Pick<PermissionOverride, "resource" | "action" | "scope" | "effect">[],
): EffectivePermission[] {
  const resources: ResourceKey[] = [
    "leads",
    "deals",
    "accounts",
    "contacts",
    "activities",
  ];
  const actions: ActionKey[] = ["read", "write", "delete"];
  const defaults = ROLE_DEFAULT_SCOPE[role] ?? {};

  const out: EffectivePermission[] = [];
  for (const resource of resources) {
    for (const action of actions) {
      const baseScope = defaults[resource] ?? "own";
      let scope: ScopeKey = baseScope;
      let denied = false;

      for (const o of overrides) {
        if (o.resource !== resource || o.action !== action) continue;
        if (o.effect === "deny") {
          denied = true;
          break;
        }
        scope = maxScope(scope, o.scope);
      }

      if (!denied) {
        out.push({ resource, action, scope });
      }
    }
  }
  return out;
}
