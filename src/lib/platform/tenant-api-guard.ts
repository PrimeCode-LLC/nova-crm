import { NextResponse } from "next/server";
import type { Auth } from "firebase-admin/auth";
import { getAdminAuth } from "@/lib/firebase/admin";
import { getVerifiedSession, type AppSession } from "@/lib/auth/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import type { OrgMemberRole } from "@/lib/types";
import { findMembershipForUserServer } from "@/lib/platform/members-server";

export type TenantApiContext = {
  session: AppSession & { organizationId: string };
  adminAuth: Auth;
  role: OrgMemberRole;
};

export type TenantGuardResult =
  | { ok: true; ctx: TenantApiContext }
  | { ok: false; response: NextResponse };

const ROLE_ORDER: Record<OrgMemberRole, number> = {
  owner: 4,
  admin: 3,
  manager: 2,
  member: 1,
};

export function roleAtLeast(have: OrgMemberRole, need: OrgMemberRole): boolean {
  return ROLE_ORDER[have] >= ROLE_ORDER[need];
}

/**
 * Guard for tenant-scoped APIs — requires a session with an `organizationId`
 * and (optionally) a minimum org role.
 *
 * Falls back to a Firestore membership lookup if claims are missing/stale,
 * so freshly-promoted users don't have to wait for an ID-token refresh.
 */
export async function guardTenantApi(opts?: {
  minRole?: OrgMemberRole;
}): Promise<TenantGuardResult> {
  if (isAuthDisabled()) {
    const adminAuth = getAdminAuth();
    if (!adminAuth) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Firebase Admin is not configured." },
          { status: 503 },
        ),
      };
    }
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
        adminAuth,
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

  let organizationId = session.organizationId;
  let role = session.orgRole;
  if (!organizationId || !role) {
    const membership = await findMembershipForUserServer(session.uid);
    if (membership) {
      organizationId = membership.organizationId;
      role = membership.role;
    }
  }

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

  const adminAuth = getAdminAuth();
  if (!adminAuth) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Firebase Admin is not configured." },
        { status: 503 },
      ),
    };
  }

  return {
    ok: true,
    ctx: {
      session: { ...session, organizationId } as AppSession & {
        organizationId: string;
      },
      adminAuth,
      role,
    },
  };
}
