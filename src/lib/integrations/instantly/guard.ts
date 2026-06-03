import { NextResponse } from "next/server";
import type { DocumentData } from "firebase-admin/firestore";
import type { AdminFeatureKey } from "@/lib/admin-features";
import { userHasAdminFeature } from "@/lib/admin-feature-access";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { roleAtLeast } from "@/lib/platform/org-role";
import type { OrgMemberRole, Role, User } from "@/lib/types";
import { getInstantlyApiKeyServer, hasInstantlyApiKeyServer } from "./secrets";

function asUserFromAdmin(id: string, raw: DocumentData): User {
  const r = raw as Record<string, unknown>;
  return {
    id,
    email: String(r.email ?? ""),
    displayName: String(r.displayName ?? r.email ?? id),
    roleId: (r.roleId as Role) ?? "salesperson",
    isSuperAdmin: Boolean(r.isSuperAdmin),
    orgRole: r.orgRole as User["orgRole"],
    featureGrants: Array.isArray(r.featureGrants)
      ? (r.featureGrants as User["featureGrants"])
      : undefined,
    status: (r.status as User["status"]) ?? "active",
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
  };
}

export async function guardInstantlyApi(opts?: {
  minRole?: OrgMemberRole;
  /** When set with `minRole`, org members below `minRole` may pass if they hold this grant. */
  grantFeature?: AdminFeatureKey;
}): Promise<
  | { ok: true; organizationId: string; uid: string; apiKey: string }
  | { ok: false; response: NextResponse }
> {
  const tenantMinRole = opts?.grantFeature ? "member" : opts?.minRole;
  const g = await guardTenantApi(tenantMinRole ? { minRole: tenantMinRole } : undefined);
  if (!g.ok) return { ok: false, response: g.response };

  if (opts?.minRole && !roleAtLeast(g.ctx.role, opts.minRole)) {
    if (!opts.grantFeature) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      };
    }
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
    const snap = await db.collection(COLLECTIONS.users).doc(g.ctx.session.uid).get();
    const actor = snap.exists ? asUserFromAdmin(g.ctx.session.uid, snap.data()!) : null;
    if (!actor || !userHasAdminFeature(actor, opts.grantFeature, g.ctx.role)) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      };
    }
  }
  const connected = await hasInstantlyApiKeyServer(g.ctx.session.organizationId);
  if (!connected) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Instantly is not connected. Add your API key in Settings → Integrations." },
        { status: 400 },
      ),
    };
  }
  const apiKey = await getInstantlyApiKeyServer(g.ctx.session.organizationId);
  if (!apiKey) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Instantly API key unavailable" }, { status: 503 }),
    };
  }
  return {
    ok: true,
    organizationId: g.ctx.session.organizationId,
    uid: g.ctx.session.uid,
    apiKey,
  };
}
