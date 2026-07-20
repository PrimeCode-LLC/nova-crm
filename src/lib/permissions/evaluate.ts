import type {
  ActionKey,
  DataScope,
  ModuleCapability,
  ModuleKey,
  ModulePermission,
} from "@/lib/permissions/catalog";

export function moduleAllows(
  modules: Record<ModuleKey, ModulePermission>,
  module: ModuleKey,
  capability: ModuleCapability,
): boolean {
  const m = modules[module];
  if (!m?.view && capability !== "view") return false;
  return Boolean(m?.[capability]);
}

export function actionAllowed(
  actions: Partial<Record<ActionKey, boolean>>,
  action: ActionKey,
): boolean {
  return actions[action] === true;
}

export function scopeAllowed(
  modules: Record<ModuleKey, ModulePermission>,
  module: ModuleKey,
): DataScope {
  const m = modules[module];
  if (!m?.view) return "none";
  return m.scope === "none" ? "own" : m.scope;
}
