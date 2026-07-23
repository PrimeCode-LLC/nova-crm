import {
  ACTION_KEYS,
  MODULE_KEYS,
  emptyModulePermission,
  modulePermission,
  type ActionKey,
  type DataScope,
  type ModuleKey,
  type ModulePermission,
} from "@/lib/permissions/catalog";
import type { WorkspaceRoleDoc } from "@/lib/permissions/role-types";
import type { SystemRoleId } from "@/lib/types";
import { ROLES } from "@/lib/constants";

function allModules(
  fill: (key: ModuleKey) => ModulePermission,
): Record<ModuleKey, ModulePermission> {
  const out = {} as Record<ModuleKey, ModulePermission>;
  for (const key of MODULE_KEYS) {
    out[key] = fill(key);
  }
  return out;
}

function scopeFill(scope: DataScope, opts?: {
  configView?: boolean;
  configEdit?: boolean;
  workspaceCreate?: boolean;
  workspaceDelete?: boolean;
}): (key: ModuleKey) => ModulePermission {
  const configModules = new Set<ModuleKey>([
    "organization",
    "people",
    "hierarchy",
    "roles",
    "permissions",
    "activity_logs",
    "departments",
    "channels",
    "profiles",
    "ai_knowledge",
    "labels",
    "intent_playbook",
    "prospecting_strategies",
    "buyer_personas",
    "import",
    "scrapers",
  ]);
  return (key) => {
    if (key === "settings_self") {
      return modulePermission({ view: true, edit: true, scope: "own" });
    }
    if (configModules.has(key)) {
      const view = opts?.configView ?? false;
      const edit = opts?.configEdit ?? false;
      return modulePermission({
        view,
        create: edit,
        edit,
        delete: edit && key !== "activity_logs" && key !== "organization",
        scope: view ? "all" : "none",
      });
    }
    return modulePermission({
      view: true,
      create: opts?.workspaceCreate ?? true,
      edit: true,
      delete: opts?.workspaceDelete ?? false,
      scope,
    });
  };
}

function actionsOn(keys: ActionKey[]): Partial<Record<ActionKey, boolean>> {
  const out: Partial<Record<ActionKey, boolean>> = {};
  for (const k of keys) out[k] = true;
  return out;
}

function allActionsOn(): Partial<Record<ActionKey, boolean>> {
  const out: Partial<Record<ActionKey, boolean>> = {};
  for (const k of ACTION_KEYS) out[k] = true;
  return out;
}

const FRONTLINE_ACTIONS: ActionKey[] = [
  "leads.change_stage",
  "leads.log_touchpoint",
  "leads.ai_suggest",
  "leads.manage_labels",
  "prospects.edit_sourced",
  "prospects.push_to_lead",
  "deals.change_stage",
];

const TEAM_LEAD_ACTIONS: ActionKey[] = [
  ...FRONTLINE_ACTIONS,
  "leads.reassign",
  "leads.archive",
  "leads.bulk_edit",
  "leads.export",
  "prospects.assign_channels",
  "prospects.promote_from_intake",
  "deals.export",
  "outreach.create_campaign",
  "outreach.edit_campaign",
  "outreach.send_test",
  "mailbox.view_others",
  "scheduling.manage_org_links",
  "dashboard.view_team_ops",
  "dashboard.view_mailbox_utilization",
  "people.edit_hierarchy",
];

const MANAGER_ACTIONS: ActionKey[] = [
  ...TEAM_LEAD_ACTIONS,
  "intake.delete_posts",
  "intake.bulk_dismiss",
  "intake.configure_filters",
  "accounts.merge",
  "contacts.merge",
  "outreach.delete_campaign",
  "mailbox.send_as_other",
  "scheduling.delegate_calendar",
  "team_chat.manage_channels",
  "dashboard.preview_as_role",
  "dashboard.export",
  "people.invite",
  "people.edit_crm_role",
  "strategies.assign_users",
  "strategies.edit_targets",
  "scrapers.run",
  "scrapers.edit_feeds",
  "import.run",
];

const DIRECTOR_EXTRA: ActionKey[] = [
  "people.disable",
  "people.edit_feature_grants",
  "roles.manage",
  "permissions.manage_overrides",
  "notifications.broadcast",
  "ai.manage_providers",
  "ai.manage_knowledge",
  "ai.view_usage",
  "organization.edit",
  "organization.billing",
  "audit.export",
];

const PROSPECTING_ACTIONS: ActionKey[] = [
  "leads.log_touchpoint",
  "prospects.assign_channels",
  "prospects.push_to_lead",
  "prospects.edit_sourced",
  "prospects.promote_from_intake",
  "intake.bulk_dismiss",
  "leads.ai_suggest",
];

function directorModules(): Record<ModuleKey, ModulePermission> {
  return allModules((key) => {
    if (key === "settings_self") {
      return modulePermission({ view: true, edit: true, scope: "own" });
    }
    return modulePermission({
      view: true,
      create: key !== "activity_logs" && key !== "dashboard" && key !== "inbox" && key !== "notifications" && key !== "activity" && key !== "fit_check" && key !== "my_strategy",
      edit: key !== "activity_logs" && key !== "dashboard" && key !== "inbox" && key !== "notifications" && key !== "activity",
      delete:
        key !== "activity_logs" &&
        key !== "dashboard" &&
        key !== "organization" &&
        key !== "inbox" &&
        key !== "notifications" &&
        key !== "activity" &&
        key !== "fit_check" &&
        key !== "my_strategy",
      scope: "all",
    });
  });
}

function managerModules(): Record<ModuleKey, ModulePermission> {
  return allModules(
    scopeFill("team", {
      configView: true,
      configEdit: true,
      workspaceCreate: true,
      workspaceDelete: true,
    }),
  );
}

function teamLeadModules(): Record<ModuleKey, ModulePermission> {
  return allModules((key) => {
    const elevatedConfig = new Set<ModuleKey>(["profiles", "labels", "channels"]);
    if (key === "settings_self") {
      return modulePermission({ view: true, edit: true, scope: "own" });
    }
    if (elevatedConfig.has(key)) {
      return modulePermission({ view: true, create: true, edit: true, delete: false, scope: "all" });
    }
    if (
      key === "organization" ||
      key === "people" ||
      key === "hierarchy" ||
      key === "roles" ||
      key === "permissions" ||
      key === "activity_logs" ||
      key === "departments" ||
      key === "ai_knowledge" ||
      key === "intent_playbook" ||
      key === "prospecting_strategies" ||
      key === "buyer_personas" ||
      key === "import" ||
      key === "scrapers"
    ) {
      return emptyModulePermission();
    }
    return modulePermission({
      view: true,
      create: true,
      edit: true,
      delete: false,
      scope: "team",
    });
  });
}

function salespersonModules(): Record<ModuleKey, ModulePermission> {
  return allModules((key) => {
    if (key === "settings_self") {
      return modulePermission({ view: true, edit: true, scope: "own" });
    }
    const blocked = new Set<ModuleKey>([
      "organization",
      "people",
      "hierarchy",
      "roles",
      "permissions",
      "activity_logs",
      "departments",
      "channels",
      "profiles",
      "ai_knowledge",
      "labels",
      "intent_playbook",
      "prospecting_strategies",
      "buyer_personas",
      "import",
      "scrapers",
      "email_outreach",
    ]);
    if (blocked.has(key)) return emptyModulePermission();
    return modulePermission({
      view: true,
      create: key !== "dashboard" && key !== "inbox" && key !== "notifications" && key !== "activity" && key !== "fit_check" && key !== "my_strategy",
      edit: key !== "dashboard" && key !== "inbox" && key !== "notifications" && key !== "activity",
      delete: false,
      scope: "own",
    });
  });
}

function prospectingModules(): Record<ModuleKey, ModulePermission> {
  return allModules((key) => {
    if (key === "settings_self") {
      return modulePermission({ view: true, edit: true, scope: "own" });
    }
    const strong = new Set<ModuleKey>([
      "dashboard",
      "prospects",
      "intake",
      "my_strategy",
      "fit_check",
      "accounts",
      "contacts",
      "tasks",
      "scripts",
      "inbox",
      "notifications",
      "team_chat",
      "activity",
      "leads",
    ]);
    if (!strong.has(key)) return emptyModulePermission();
    const readHeavy = key === "dashboard" || key === "inbox" || key === "notifications" || key === "activity" || key === "my_strategy" || key === "fit_check";
    return modulePermission({
      view: true,
      create: !readHeavy && (key === "prospects" || key === "accounts" || key === "contacts" || key === "tasks" || key === "scripts"),
      edit: !readHeavy,
      delete: false,
      scope: "own",
    });
  });
}

export type SystemRolePreset = Omit<
  WorkspaceRoleDoc,
  "createdAt" | "updatedAt" | "createdByUid" | "updatedByUid"
>;

export const SYSTEM_ROLE_PRESETS: Record<
  Exclude<SystemRoleId, "data_scraper">,
  SystemRolePreset
> = {
  director: {
    id: "director",
    name: ROLES.director.label,
    description: ROLES.director.description,
    kind: "system",
    systemKey: "director",
    isActive: true,
    modules: directorModules(),
    actions: allActionsOn(),
  },
  manager: {
    id: "manager",
    name: ROLES.manager.label,
    description: ROLES.manager.description,
    kind: "system",
    systemKey: "manager",
    isActive: true,
    modules: managerModules(),
    actions: actionsOn([...MANAGER_ACTIONS, ...DIRECTOR_EXTRA.filter((a) => a !== "roles.manage" && a !== "organization.billing")]),
  },
  team_lead: {
    id: "team_lead",
    name: ROLES.team_lead.label,
    description: ROLES.team_lead.description,
    kind: "system",
    systemKey: "team_lead",
    isActive: true,
    modules: teamLeadModules(),
    actions: actionsOn(TEAM_LEAD_ACTIONS),
  },
  salesperson: {
    id: "salesperson",
    name: ROLES.salesperson.label,
    description: ROLES.salesperson.description,
    kind: "system",
    systemKey: "salesperson",
    isActive: true,
    modules: salespersonModules(),
    actions: actionsOn(FRONTLINE_ACTIONS),
  },
  prospecting: {
    id: "prospecting",
    name: ROLES.prospecting.label,
    description: ROLES.prospecting.description,
    kind: "system",
    systemKey: "prospecting",
    isActive: true,
    modules: prospectingModules(),
    actions: actionsOn(PROSPECTING_ACTIONS),
  },
};

/** Legacy `data_scraper` maps to the prospecting preset. */
export function resolveSystemPresetKey(
  roleId: string | undefined,
): Exclude<SystemRoleId, "data_scraper"> {
  if (roleId === "data_scraper") return "prospecting";
  if (roleId && roleId in SYSTEM_ROLE_PRESETS) {
    return roleId as Exclude<SystemRoleId, "data_scraper">;
  }
  return "salesperson";
}

export function buildSystemRoleDoc(
  key: Exclude<SystemRoleId, "data_scraper">,
  meta: { createdByUid: string; now?: string },
): WorkspaceRoleDoc {
  const preset = SYSTEM_ROLE_PRESETS[key];
  const now = meta.now ?? new Date().toISOString();
  return {
    ...preset,
    modules: { ...preset.modules },
    actions: { ...preset.actions },
    createdAt: now,
    updatedAt: now,
    createdByUid: meta.createdByUid,
    updatedByUid: meta.createdByUid,
  };
}

export const SYSTEM_ROLE_IDS = Object.keys(SYSTEM_ROLE_PRESETS) as Exclude<
  SystemRoleId,
  "data_scraper"
>[];

/**
 * Additive merge: fill module/action keys that were never stored on the role doc.
 * Pass `rawModuleKeys` from the Firestore document so empty placeholders created by
 * parseWorkspaceRoleDoc for brand-new catalog keys still get preset defaults.
 */
export function mergeCatalogAdditions(
  existing: WorkspaceRoleDoc,
  preset: SystemRolePreset,
  rawModuleKeys?: Iterable<string>,
): WorkspaceRoleDoc {
  const known = rawModuleKeys ? new Set(rawModuleKeys) : null;
  const modules = { ...existing.modules };
  for (const key of MODULE_KEYS) {
    const missingFromRaw = known ? !known.has(key) : !modules[key];
    if (missingFromRaw) {
      modules[key] = preset.modules[key] ?? emptyModulePermission();
    }
  }
  const actions = { ...existing.actions };
  for (const key of ACTION_KEYS) {
    if (actions[key] === undefined && preset.actions[key] !== undefined) {
      actions[key] = preset.actions[key];
    }
  }
  return { ...existing, modules, actions };
}
