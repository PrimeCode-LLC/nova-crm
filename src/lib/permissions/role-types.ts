import type {
  ActionKey,
  DataScope,
  ModuleKey,
  ModulePermission,
} from "@/lib/permissions/catalog";
import type { SystemRoleId } from "@/lib/types";

export type WorkspaceRoleKind = "system" | "custom";

export type WorkspaceRoleDoc = {
  id: string;
  name: string;
  description?: string;
  kind: WorkspaceRoleKind;
  /** Set for seeded presets so migration / dual-read can map legacy Role ids. */
  systemKey?: SystemRoleId;
  isActive: boolean;
  modules: Record<ModuleKey, ModulePermission>;
  /** Missing keys are treated as false. */
  actions: Partial<Record<ActionKey, boolean>>;
  createdAt: string;
  updatedAt: string;
  createdByUid: string;
  updatedByUid: string;
};

/** Flattened effective permissions stored on `computedPermissions/{uid}`. */
export type ComputedPermissionsDoc = {
  uid: string;
  organizationId: string;
  roleId: string;
  modules: Record<ModuleKey, ModulePermission>;
  actions: Partial<Record<ActionKey, boolean>>;
  updatedAt: string;
};

export type RoleListItem = WorkspaceRoleDoc & {
  memberCount: number;
};

export type EffectivePermissionSnapshot = {
  roleId: string;
  modules: Record<ModuleKey, ModulePermission>;
  actions: Partial<Record<ActionKey, boolean>>;
  source: "role_doc" | "legacy_fallback";
};

export function normalizeDataScope(value: unknown): DataScope {
  // Legacy role documents used "department" without naming a specific group.
  // Treat it as the reporting tree; selected-team grants belong in person overrides.
  if (value === "department") return "team";
  if (
    value === "none" ||
    value === "own" ||
    value === "team" ||
    value === "all"
  ) {
    return value;
  }
  return "own";
}
