import { NextResponse } from "next/server";
import type { DocumentData } from "firebase-admin/firestore";
import type { AdminFeatureKey } from "@/lib/admin-features";
import { userHasAdminFeature, normalizeFeatureGrants } from "@/lib/admin-feature-access";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { firestoreValueToIso } from "@/lib/firestore/timestamp-util";
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
    createdAt: firestoreValueToIso(r.createdAt),
  };
}

export type AdminFeatureGuardResult =
  | { ok: true; ctx: TenantApiContext; actor: User }
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
        { error: "Firebase Admin is not configured on this server." },
        { status: 503 },
      ),
    };
  }

  const snap = await db.collection(COLLECTIONS.users).doc(base.ctx.session.uid).get();
  const actor = snap.exists ? asUserFromAdmin(base.ctx.session.uid, snap.data()!) : null;

  if (!actor || !userHasAdminFeature(actor, feature, base.ctx.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, ctx: base.ctx, actor };
}
