import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import {
  ACTION_KEYS,
  MODULE_KEYS,
  emptyModulePermission,
  type ActionKey,
  type DataScope,
  type ModuleKey,
  type ModulePermission,
} from "@/lib/permissions/catalog";
import { canAction } from "@/lib/permissions/can";
import { resolveRoleForUser } from "@/lib/permissions/roles-server";
import type { Role, User } from "@/lib/types";
import { normalizeFeatureGrants } from "@/lib/admin-feature-access";

export function sanitizeModules(
  raw: Record<
    string,
    {
      view: boolean;
      create: boolean;
      edit: boolean;
      delete: boolean;
      scope: string;
    }
  >,
): Record<ModuleKey, ModulePermission> {
  const out = {} as Record<ModuleKey, ModulePermission>;
  for (const key of MODULE_KEYS) {
    const m = raw[key];
    out[key] = m
      ? {
          view: m.view,
          create: m.create,
          edit: m.edit,
          delete: m.delete,
          scope: m.scope as DataScope,
        }
      : emptyModulePermission();
  }
  return out;
}

export function sanitizeActions(
  raw: Record<string, boolean>,
): Partial<Record<ActionKey, boolean>> {
  const out: Partial<Record<ActionKey, boolean>> = {};
  for (const key of ACTION_KEYS) {
    if (raw[key] === true) out[key] = true;
    else if (raw[key] === false) out[key] = false;
  }
  return out;
}

async function loadActorUser(uid: string, organizationId: string): Promise<User | null> {
  const db = getAdminDb();
  if (!db) return null;
  const snap = await db.collection(COLLECTIONS.users).doc(uid).get();
  if (!snap.exists) return null;
  const r = snap.data() as Record<string, unknown>;
  if (r.organizationId !== organizationId) return null;
  return {
    id: uid,
    email: String(r.email ?? ""),
    displayName: String(r.displayName ?? ""),
    roleId: (r.roleId as Role) ?? "salesperson",
    isSuperAdmin: Boolean(r.isSuperAdmin),
    orgRole: r.orgRole as User["orgRole"],
    featureGrants: normalizeFeatureGrants(r.featureGrants),
    status: (r.status as User["status"]) ?? "active",
    createdAt: String(r.createdAt ?? ""),
  };
}

export async function assertCanManageRoles(
  uid: string,
  organizationId: string,
  orgRole: string,
) {
  if (orgRole === "owner" || orgRole === "admin") return { ok: true as const };
  const user = await loadActorUser(uid, organizationId);
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  const roleDoc = await resolveRoleForUser({
    organizationId,
    roleId: user.roleId,
    actorUid: uid,
  });
  const allowed = canAction({ ...user, roleSnapshot: roleDoc }, "roles.manage");
  if (!allowed && user.roleId !== "director" && !user.isSuperAdmin) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true as const };
}
