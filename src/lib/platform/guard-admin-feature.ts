import { NextResponse } from "next/server";
import type { DocumentData } from "@/lib/db/document-shim/shim-firestore";
import type { AdminFeatureKey } from "@/lib/admin-features";
import { userHasAdminFeature, normalizeFeatureGrants } from "@/lib/admin-feature-access";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { documentTimestampToIso } from "@/lib/documents/timestamp-util";
import { canAction, type PermissionSubject } from "@/lib/permissions/can";
import { parseComputedPermissionsDoc } from "@/lib/permissions/computed-permissions";
import type { ActionKey } from "@/lib/permissions/catalog";
import type { EffectivePermissionSnapshot } from "@/lib/permissions/role-types";
import type { Role, User } from "@/lib/types";
import {
  guardTenantApi,
  type TenantApiContext,
  type TenantGuardResult,
} from "@/lib/platform/tenant-api-guard";

function asUserFromAdmin(id: string, raw: DocumentData): User {
  const r = raw as Record<string, unknown>;
  return {
    id,
    email: String(r.email ?? ""),
    displayName: String(r.displayName ?? r.email ?? id),
    roleId: (r.roleId as Role) ?? "salesperson",
    isSuperAdmin: Boolean(r.isSuperAdmin),
    orgRole: r.orgRole as User["orgRole"],
    featureGrants: normalizeFeatureGrants(r.featureGrants),
    status: (r.status as User["status"]) ?? "active",
    createdAt: documentTimestampToIso(r.createdAt),
  };
}

async function loadRoleSnapshot(
  uid: string,
): Promise<EffectivePermissionSnapshot | null> {
  const db = getAdminDb();
  if (!db) return null;
  const snap = await db.collection(COLLECTIONS.computedPermissions).doc(uid).get();
  if (!snap.exists) return null;
  return parseComputedPermissionsDoc(snap.data() as Record<string, unknown>);
}

function withSnapshot(
  actor: User,
  roleSnapshot: EffectivePermissionSnapshot | null,
): PermissionSubject {
  return { ...actor, roleSnapshot };
}

export type AdminFeatureGuardResult =
  | { ok: true; ctx: TenantApiContext; actor: User; roleSnapshot: EffectivePermissionSnapshot | null }
  | { ok: false; response: NextResponse };

export async function guardAdminFeature(
  feature: AdminFeatureKey,
): Promise<AdminFeatureGuardResult> {
  const base: TenantGuardResult = await guardTenantApi();
  if (!base.ok) return base;

  const db = getAdminDb();
  if (!db) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Document store is not configured (DATABASE_URL missing)." },
        { status: 503 },
      ),
    };
  }

  const snap = await db.collection(COLLECTIONS.users).doc(base.ctx.session.uid).get();
  const actor = snap.exists ? asUserFromAdmin(base.ctx.session.uid, snap.data()!) : null;
  const roleSnapshot = actor ? await loadRoleSnapshot(actor.id) : null;
  const subject = actor ? withSnapshot(actor, roleSnapshot) : undefined;

  if (!actor || !userHasAdminFeature(subject, feature, base.ctx.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, ctx: base.ctx, actor, roleSnapshot };
}

/**
 * Allow when the role catalog action is granted, or (optionally) when a related
 * admin feature is granted - used for scraper runs from Intake without full feed admin.
 */
export async function guardPermissionAction(
  action: ActionKey,
  opts?: { orAdminFeature?: AdminFeatureKey },
): Promise<AdminFeatureGuardResult> {
  const base: TenantGuardResult = await guardTenantApi();
  if (!base.ok) return base;

  const db = getAdminDb();
  if (!db) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Document store is not configured (DATABASE_URL missing)." },
        { status: 503 },
      ),
    };
  }

  const snap = await db.collection(COLLECTIONS.users).doc(base.ctx.session.uid).get();
  const actor = snap.exists ? asUserFromAdmin(base.ctx.session.uid, snap.data()!) : null;
  const roleSnapshot = actor ? await loadRoleSnapshot(actor.id) : null;
  const subject = actor ? withSnapshot(actor, roleSnapshot) : undefined;

  const allowed =
    Boolean(actor) &&
    (canAction(subject, action) ||
      (opts?.orAdminFeature
        ? userHasAdminFeature(subject, opts.orAdminFeature, base.ctx.role)
        : false));

  if (!actor || !allowed) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, ctx: base.ctx, actor, roleSnapshot };
}
