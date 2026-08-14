import { NextResponse } from "next/server";
import type { Auth } from "firebase-admin/auth";
import { getAdminAuth } from "@/lib/firebase/admin";
import { getVerifiedSession, type AppSession } from "@/lib/auth/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import type { OrgMemberRole } from "@/lib/types";
import { resolveLiveTenantForSession } from "@/lib/auth/resolve-live-tenant";
import { roleAtLeast } from "./org-role";

export { roleAtLeast };

export type TenantApiContext = {
  session: AppSession & { organizationId: string };
  /** Null when Firebase Admin is disabled / not configured (Clerk + Postgres path). */
  adminAuth: Auth | null;
  role: OrgMemberRole;
};

export type TenantGuardResult =
  | { ok: true; ctx: TenantApiContext }
  | { ok: false; response: NextResponse };

/**
 * Guard for tenant-scoped APIs - requires a session with an `organizationId`
 * and (optionally) a minimum org role.
 *
 * Falls back to a membership lookup if claims are missing/stale,
 * so freshly-promoted users don't have to wait for an ID-token refresh.
 *
 * Firebase Admin is optional: Clerk + Postgres membership is enough for CRM APIs.
 */
export async function guardTenantApi(opts?: {
  minRole?: OrgMemberRole;
}): Promise<TenantGuardResult> {
  if (isAuthDisabled()) {
    return {
      ok: true,
      ctx: {
        session: {
          uid: "dev",
          email: "dev@local",
          name: "Dev user",
          organizationId: "dev-org",
          orgRole: "owner",
        } as AppSession & { organizationId: string },
        adminAuth: getAdminAuth(),
        role: "owner",
      },
    };
  }

  const session = await getVerifiedSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const liveTenant = await resolveLiveTenantForSession(session);
  if (liveTenant.accessDeniedReason) {
    const message =
      liveTenant.accessDeniedReason === "inactive_user"
        ? "Your Nova user is inactive."
        : liveTenant.accessDeniedReason === "suspended_organization"
          ? "This Nova organization is suspended."
          : "Your workspace membership is not active.";
    return {
      ok: false,
      response: NextResponse.json(
        { error: message, code: liveTenant.accessDeniedReason },
        { status: 403 },
      ),
    };
  }
  if (liveTenant.membershipPending) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Workspace access is pending admin approval.",
          code: "membership_pending",
        },
        { status: 403 },
      ),
    };
  }

  const organizationId = liveTenant.organizationId;
  const role = liveTenant.orgRole;

  if (!organizationId || !role) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Workspace not set up." },
        { status: 403 },
      ),
    };
  }

  if (opts?.minRole && !roleAtLeast(role, opts.minRole)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return {
    ok: true,
    ctx: {
      session: { ...session, organizationId } as AppSession & {
        organizationId: string;
      },
      adminAuth: getAdminAuth(),
      role,
    },
  };
}
