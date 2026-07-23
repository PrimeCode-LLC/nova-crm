/** Standalone copy for Cloud Functions (no import from Next `src/`). */

export type Role =
  | "director"
  | "manager"
  | "team_lead"
  | "salesperson"
  | "data_scraper"
  | "prospecting"
  | "content_team";

export type ResourceKey =
  | "leads"
  | "deals"
  | "accounts"
  | "contacts"
  | "activities";

export type ActionKey = "read" | "write" | "delete";
export type ScopeKey = "own" | "team" | "department" | "all" | "custom";

export type Override = {
  resource: ResourceKey;
  action: ActionKey;
  scope: ScopeKey;
  effect: "grant" | "deny";
};

export type EffectivePermission = {
  resource: ResourceKey;
  action: ActionKey;
  scope: ScopeKey;
};

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
  prospecting: {
    leads: "own",
    deals: "own",
    accounts: "own",
    contacts: "own",
    activities: "own",
  },
  content_team: {},
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

export function mergePermissions(role: Role, overrides: Override[]): EffectivePermission[] {
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
