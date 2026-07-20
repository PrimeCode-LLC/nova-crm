import type {
  ActionKey,
  ModuleCapability,
  ModuleKey,
} from "@/lib/permissions/catalog";
import {
  MODULE_BY_HREF,
  MODULE_KEYS,
  emptyModulePermission,
} from "@/lib/permissions/catalog";
import {
  buildSystemRoleDoc,
  resolveSystemPresetKey,
  SYSTEM_ROLE_PRESETS,
} from "@/lib/permissions/role-presets";
import type {
  EffectivePermissionSnapshot,
  WorkspaceRoleDoc,
} from "@/lib/permissions/role-types";
import {
  actionAllowed,
  moduleAllows,
  scopeAllowed,
} from "@/lib/permissions/evaluate";
import type { AdminFeatureKey } from "@/lib/admin-features";
import { ADMIN_FEATURES } from "@/lib/admin-features";
import type { OrgMemberRole, Role, User } from "@/lib/types";
import { roleAtLeast } from "@/lib/platform/org-role";
import { workspaceRoleMeetsMin } from "@/lib/permissions/admin-feature-access-rank";

export type PermissionSubject = Pick<
  User,
  "roleId" | "isSuperAdmin" | "featureGrants" | "orgRole"
> & {
  /** When present (from computedPermissions or hydrated role), preferred over legacy fallback. */
  roleSnapshot?: EffectivePermissionSnapshot | WorkspaceRoleDoc | null;
};

const ADMIN_FEATURE_TO_MODULE: Partial<Record<AdminFeatureKey, ModuleKey>> = {
  ai_knowledge: "ai_knowledge",
  labels: "labels",
  import: "import",
  scrapers: "scrapers",
  permissions: "permissions",
  roles: "roles",
  activity_logs: "activity_logs",
  organization: "organization",
  team: "people",
  users: "people",
  hierarchy: "hierarchy",
  departments: "departments",
  channels: "channels",
  profiles: "profiles",
  email_outreach: "email_outreach",
  intent_playbook: "intent_playbook",
  buyer_personas: "buyer_personas",
  prospecting_strategies: "prospecting_strategies",
};

const ADMIN_FEATURE_TO_ACTION: Partial<Record<AdminFeatureKey, ActionKey>> = {
  create_campaigns: "outreach.create_campaign",
  delete_intake_pool: "intake.delete_posts",
};

function snapshotFromPreset(roleId: Role | undefined): EffectivePermissionSnapshot {
  const key = resolveSystemPresetKey(roleId);
  const preset = SYSTEM_ROLE_PRESETS[key];
  return {
    roleId: key,
    modules: preset.modules,
    actions: preset.actions,
    source: "legacy_fallback",
  };
}

export function resolveEffectivePermissions(
  subject: PermissionSubject | undefined,
): EffectivePermissionSnapshot {
  if (!subject) {
    return snapshotFromPreset("salesperson");
  }
  if (subject.isSuperAdmin) {
    const director = buildSystemRoleDoc("director", { createdByUid: "system" });
    return {
      roleId: "director",
      modules: director.modules,
      actions: director.actions,
      source: "legacy_fallback",
    };
  }
  const snap = subject.roleSnapshot;
  if (snap && "modules" in snap && snap.modules) {
    return {
      roleId: "id" in snap ? snap.id : snap.roleId,
      modules: snap.modules,
      actions: snap.actions ?? {},
      source: "source" in snap ? snap.source : "role_doc",
    };
  }
  return snapshotFromPreset(subject.roleId);
}

export function can(
  subject: PermissionSubject | undefined,
  module: ModuleKey,
  capability: ModuleCapability = "view",
): boolean {
  if (subject?.isSuperAdmin) return true;
  const eff = resolveEffectivePermissions(subject);
  return moduleAllows(eff.modules, module, capability);
}

export function canAction(
  subject: PermissionSubject | undefined,
  action: ActionKey,
): boolean {
  if (subject?.isSuperAdmin) return true;
  const eff = resolveEffectivePermissions(subject);
  return actionAllowed(eff.actions, action);
}

export function scopeFor(
  subject: PermissionSubject | undefined,
  module: ModuleKey,
) {
  if (subject?.isSuperAdmin) return "all" as const;
  const eff = resolveEffectivePermissions(subject);
  return scopeAllowed(eff.modules, module);
}

/**
 * Dual-read bridge: role catalog modules/actions, then legacy admin feature grants
 * and historical org/workspace role gates.
 */
export function canAdminFeature(
  subject: PermissionSubject | undefined,
  feature: AdminFeatureKey,
  orgRole?: OrgMemberRole,
): boolean {
  if (!subject) return false;
  if (subject.isSuperAdmin) return true;

  const action = ADMIN_FEATURE_TO_ACTION[feature];
  if (action && canAction(subject, action)) return true;

  const module = ADMIN_FEATURE_TO_MODULE[feature];
  if (module && can(subject, module, "view")) return true;

  if (subject.featureGrants?.includes(feature)) return true;

  const meta = ADMIN_FEATURES[feature];
  const effectiveOrgRole = orgRole ?? subject.orgRole;
  const eff = resolveEffectivePermissions(subject);

  // When a real role doc is loaded, catalog + grants are authoritative.
  if (eff.source === "role_doc") {
    return false;
  }

  // Legacy fallback: historical min role gates.
  if (feature === "activity_logs") {
    return Boolean(effectiveOrgRole && roleAtLeast(effectiveOrgRole, "admin"));
  }
  if (meta.minOrgRole && effectiveOrgRole && roleAtLeast(effectiveOrgRole, meta.minOrgRole)) {
    return true;
  }
  if (meta.minWorkspaceRole && workspaceRoleMeetsMin(subject.roleId, meta.minWorkspaceRole)) {
    return true;
  }
  if (!meta.minWorkspaceRole && !meta.minOrgRole && !module && !action) {
    return true;
  }

  return false;
}

export function canAccessHref(
  subject: PermissionSubject | undefined,
  href: string,
): boolean {
  const module = MODULE_BY_HREF[href];
  if (!module) return true;
  return can(subject, module, "view");
}

export function emptyModulesRecord() {
  const out = {} as Record<ModuleKey, ReturnType<typeof emptyModulePermission>>;
  for (const key of MODULE_KEYS) {
    out[key] = emptyModulePermission();
  }
  return out;
}
