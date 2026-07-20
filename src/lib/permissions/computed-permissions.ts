import type { ActionKey, ModuleKey, ModulePermission } from "@/lib/permissions/catalog";
import type {
  ComputedPermissionsDoc,
  EffectivePermissionSnapshot,
} from "@/lib/permissions/role-types";

/**
 * Accepts the Roles-catalog shape written by `writeComputedPermissions`.
 * Ignores legacy Cloud Function docs (`{ userId, effective }`) that lack modules.
 */
export function parseComputedPermissionsDoc(
  raw: Record<string, unknown> | null | undefined,
): EffectivePermissionSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const modules = raw.modules;
  if (!modules || typeof modules !== "object" || Array.isArray(modules)) return null;

  return {
    roleId: typeof raw.roleId === "string" ? raw.roleId : "unknown",
    modules: modules as Record<ModuleKey, ModulePermission>,
    actions: (raw.actions && typeof raw.actions === "object" && !Array.isArray(raw.actions)
      ? (raw.actions as Partial<Record<ActionKey, boolean>>)
      : {}) as Partial<Record<ActionKey, boolean>>,
    source: "role_doc",
  };
}

export function toComputedPermissionsDoc(
  snap: EffectivePermissionSnapshot,
  uid: string,
  organizationId: string,
): ComputedPermissionsDoc {
  return {
    uid,
    organizationId,
    roleId: snap.roleId,
    modules: snap.modules,
    actions: snap.actions,
    updatedAt: new Date().toISOString(),
  };
}
