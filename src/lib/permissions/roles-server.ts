import {
  ACTION_KEYS,
  MODULE_KEYS,
  emptyModulePermission,
  type ActionKey,
  type ModuleKey,
  type ModulePermission,
} from "@/lib/permissions/catalog";
import {
  buildSystemRoleDoc,
  mergeCatalogAdditions,
  resolveSystemPresetKey,
  SYSTEM_ROLE_IDS,
  SYSTEM_ROLE_PRESETS,
} from "@/lib/permissions/role-presets";
import type {
  ComputedPermissionsDoc,
  RoleListItem,
  WorkspaceRoleDoc,
} from "@/lib/permissions/role-types";
import { normalizeDataScope } from "@/lib/permissions/role-types";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import type { Role } from "@/lib/types";

export {
  actionAllowed,
  moduleAllows,
  scopeAllowed,
} from "@/lib/permissions/evaluate";


function rolesCol(orgId: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.roles);
}

function parseModulePermission(raw: unknown): ModulePermission {
  if (!raw || typeof raw !== "object") return emptyModulePermission();
  const o = raw as Record<string, unknown>;
  return {
    view: Boolean(o.view),
    create: Boolean(o.create),
    edit: Boolean(o.edit),
    delete: Boolean(o.delete),
    scope: normalizeDataScope(o.scope),
  };
}

export function parseWorkspaceRoleDoc(
  id: string,
  raw: Record<string, unknown>,
): WorkspaceRoleDoc {
  const modules = {} as Record<ModuleKey, ModulePermission>;
  const rawModules =
    raw.modules && typeof raw.modules === "object"
      ? (raw.modules as Record<string, unknown>)
      : {};
  for (const key of MODULE_KEYS) {
    modules[key] = parseModulePermission(rawModules[key]);
  }

  const actions: Partial<Record<ActionKey, boolean>> = {};
  const rawActions =
    raw.actions && typeof raw.actions === "object"
      ? (raw.actions as Record<string, unknown>)
      : {};
  for (const key of ACTION_KEYS) {
    if (rawActions[key] === true) actions[key] = true;
    else if (rawActions[key] === false) actions[key] = false;
  }

  return {
    id,
    name: String(raw.name ?? id),
    description: typeof raw.description === "string" ? raw.description : undefined,
    kind: raw.kind === "custom" ? "custom" : "system",
    systemKey:
      typeof raw.systemKey === "string"
        ? (raw.systemKey as WorkspaceRoleDoc["systemKey"])
        : undefined,
    isActive: raw.isActive !== false,
    modules,
    actions,
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
    createdByUid: String(raw.createdByUid ?? "system"),
    updatedByUid: String(raw.updatedByUid ?? "system"),
  };
}

/** Seed system roles if missing; additively fill new catalog keys on existing system roles. */
export async function ensureOrgRolesSeeded(
  orgId: string,
  actorUid: string,
): Promise<WorkspaceRoleDoc[]> {
  const col = rolesCol(orgId);
  if (!col) throw new Error("Firebase Admin is not configured.");

  const snap = await col.get();
  const existing = new Map<string, WorkspaceRoleDoc>();
  for (const doc of snap.docs) {
    existing.set(doc.id, parseWorkspaceRoleDoc(doc.id, doc.data() as Record<string, unknown>));
  }

  const batch = col.firestore.batch();
  let writes = 0;
  const now = new Date().toISOString();

  for (const key of SYSTEM_ROLE_IDS) {
    const current = existing.get(key);
    if (!current) {
      const doc = buildSystemRoleDoc(key, { createdByUid: actorUid, now });
      batch.set(col.doc(key), doc);
      existing.set(key, doc);
      writes += 1;
    } else if (current.kind === "system") {
      const merged = mergeCatalogAdditions(current, SYSTEM_ROLE_PRESETS[key]);
      const changed =
        JSON.stringify(merged.modules) !== JSON.stringify(current.modules) ||
        JSON.stringify(merged.actions) !== JSON.stringify(current.actions);
      if (changed) {
        const next = { ...merged, updatedAt: now, updatedByUid: actorUid };
        batch.set(col.doc(key), next, { merge: true });
        existing.set(key, next);
        writes += 1;
      }
    }
  }

  if (writes > 0) await batch.commit();
  return [...existing.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listOrgRoles(orgId: string): Promise<WorkspaceRoleDoc[]> {
  const col = rolesCol(orgId);
  if (!col) throw new Error("Firebase Admin is not configured.");
  const snap = await col.get();
  return snap.docs
    .map((d) => parseWorkspaceRoleDoc(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getOrgRole(
  orgId: string,
  roleId: string,
): Promise<WorkspaceRoleDoc | null> {
  const col = rolesCol(orgId);
  if (!col) throw new Error("Firebase Admin is not configured.");
  const resolved =
    roleId === "data_scraper" ? "prospecting" : roleId;
  const snap = await col.doc(resolved).get();
  if (!snap.exists) return null;
  return parseWorkspaceRoleDoc(snap.id, snap.data() as Record<string, unknown>);
}

export async function countMembersWithRole(
  orgId: string,
  roleId: string,
): Promise<number> {
  const db = getAdminDb();
  if (!db) throw new Error("Firebase Admin is not configured.");
  const ids = roleId === "prospecting" ? ["prospecting", "data_scraper"] : [roleId];
  let total = 0;
  for (const id of ids) {
    const snap = await db
      .collection(COLLECTIONS.users)
      .where("organizationId", "==", orgId)
      .where("roleId", "==", id)
      .get();
    total += snap.size;
  }
  return total;
}

export async function listOrgRolesWithCounts(
  orgId: string,
  actorUid: string,
): Promise<RoleListItem[]> {
  const roles = await ensureOrgRolesSeeded(orgId, actorUid);
  const withCounts: RoleListItem[] = [];
  for (const role of roles) {
    const memberCount = await countMembersWithRole(orgId, role.id);
    withCounts.push({ ...role, memberCount });
  }
  return withCounts;
}

export async function createOrgRole(
  orgId: string,
  input: {
    name: string;
    description?: string;
    modules: Record<ModuleKey, ModulePermission>;
    actions: Partial<Record<ActionKey, boolean>>;
    duplicateFromId?: string;
    actorUid: string;
  },
): Promise<WorkspaceRoleDoc> {
  const col = rolesCol(orgId);
  if (!col) throw new Error("Firebase Admin is not configured.");

  let modules = input.modules;
  let actions = input.actions;
  if (input.duplicateFromId) {
    const source = await getOrgRole(orgId, input.duplicateFromId);
    if (source) {
      modules = source.modules;
      actions = source.actions;
    }
  }

  const now = new Date().toISOString();
  const ref = col.doc();
  const doc: WorkspaceRoleDoc = {
    id: ref.id,
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    kind: "custom",
    isActive: true,
    modules,
    actions,
    createdAt: now,
    updatedAt: now,
    createdByUid: input.actorUid,
    updatedByUid: input.actorUid,
  };
  await ref.set(doc);
  return doc;
}

export async function updateOrgRole(
  orgId: string,
  roleId: string,
  patch: {
    name?: string;
    description?: string | null;
    isActive?: boolean;
    modules?: Record<ModuleKey, ModulePermission>;
    actions?: Partial<Record<ActionKey, boolean>>;
    actorUid: string;
  },
): Promise<WorkspaceRoleDoc> {
  const col = rolesCol(orgId);
  if (!col) throw new Error("Firebase Admin is not configured.");
  const existing = await getOrgRole(orgId, roleId);
  if (!existing) throw new Error("Role not found");

  const now = new Date().toISOString();
  const next: WorkspaceRoleDoc = {
    ...existing,
    name: patch.name !== undefined ? patch.name.trim() : existing.name,
    description:
      patch.description === null
        ? undefined
        : patch.description !== undefined
          ? patch.description.trim() || undefined
          : existing.description,
    isActive: patch.isActive ?? existing.isActive,
    modules: patch.modules ?? existing.modules,
    actions: patch.actions ?? existing.actions,
    updatedAt: now,
    updatedByUid: patch.actorUid,
  };
  await col.doc(existing.id).set(next);
  return next;
}

export async function resetOrgRoleToPreset(
  orgId: string,
  roleId: string,
  actorUid: string,
): Promise<WorkspaceRoleDoc> {
  const existing = await getOrgRole(orgId, roleId);
  if (!existing) throw new Error("Role not found");
  if (existing.kind !== "system" || !existing.systemKey) {
    throw new Error("Only system roles can be reset to default");
  }
  const key = resolveSystemPresetKey(existing.systemKey);
  const fresh = buildSystemRoleDoc(key, { createdByUid: existing.createdByUid });
  return updateOrgRole(orgId, existing.id, {
    name: fresh.name,
    description: fresh.description ?? null,
    isActive: true,
    modules: fresh.modules,
    actions: fresh.actions,
    actorUid,
  });
}

export async function deleteOrgRole(
  orgId: string,
  roleId: string,
): Promise<{ ok: true } | { error: string }> {
  const existing = await getOrgRole(orgId, roleId);
  if (!existing) return { error: "Role not found" };
  if (existing.kind === "system") {
    return { error: "System roles cannot be deleted. Deactivate or reset instead." };
  }
  const count = await countMembersWithRole(orgId, existing.id);
  if (count > 0) {
    return {
      error: `Reassign ${count} member${count === 1 ? "" : "s"} before deleting this role.`,
    };
  }
  const col = rolesCol(orgId);
  if (!col) return { error: "Firebase Admin is not configured." };
  await col.doc(existing.id).delete();
  return { ok: true };
}

export async function writeComputedPermissions(input: {
  uid: string;
  organizationId: string;
  role: WorkspaceRoleDoc;
}): Promise<void> {
  const db = getAdminDb();
  if (!db) return;
  const doc: ComputedPermissionsDoc = {
    uid: input.uid,
    organizationId: input.organizationId,
    roleId: input.role.id,
    modules: input.role.modules,
    actions: input.role.actions,
    updatedAt: new Date().toISOString(),
  };
  await db.collection(COLLECTIONS.computedPermissions).doc(input.uid).set(doc);
}

export async function recomputeOrgRoleMembers(
  orgId: string,
  roleId: string,
): Promise<number> {
  const db = getAdminDb();
  if (!db) return 0;
  const role = await getOrgRole(orgId, roleId);
  if (!role) return 0;
  const ids = roleId === "prospecting" ? ["prospecting", "data_scraper"] : [roleId];
  let updated = 0;
  for (const id of ids) {
    const snap = await db
      .collection(COLLECTIONS.users)
      .where("organizationId", "==", orgId)
      .where("roleId", "==", id)
      .get();
    for (const doc of snap.docs) {
      await writeComputedPermissions({
        uid: doc.id,
        organizationId: orgId,
        role,
      });
      updated += 1;
    }
  }
  return updated;
}

export async function resolveRoleForUser(input: {
  organizationId: string;
  roleId: Role | undefined;
  actorUid?: string;
}): Promise<WorkspaceRoleDoc> {
  const orgId = input.organizationId;
  const roleId = input.roleId ?? "salesperson";
  try {
    if (input.actorUid) {
      await ensureOrgRolesSeeded(orgId, input.actorUid);
    }
    const doc = await getOrgRole(orgId, roleId);
    if (doc) return doc;
  } catch {
    // fall through to preset
  }
  const key = resolveSystemPresetKey(roleId);
  return buildSystemRoleDoc(key, {
    createdByUid: input.actorUid ?? "system",
  });
}
