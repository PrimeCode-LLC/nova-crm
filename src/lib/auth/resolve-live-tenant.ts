import type { AppSession } from "@/lib/auth/server";
import type { OrgMemberRole } from "@/lib/types";
import {
  findMembershipForUserServer,
  getMemberServer,
} from "@/lib/platform/members-server";

export type ResolvedTenantContext = {
  organizationId?: string;
  orgRole?: OrgMemberRole;
  membershipPending: boolean;
};

/**
 * Resolves the caller's tenant id and org role from Firestore membership,
 * preferring live data over JWT session-cookie claims (which can lag behind
 * admin role changes until the client re-exchanges the session).
 */
export async function resolveLiveTenantForSession(
  session: Pick<AppSession, "uid" | "organizationId" | "orgRole">,
): Promise<ResolvedTenantContext> {
  let organizationId = session.organizationId;
  let orgRole = session.orgRole;

  if (!organizationId || !orgRole) {
    const m = await findMembershipForUserServer(session.uid);
    if (m?.status === "pending") {
      return {
        organizationId: m.organizationId,
        orgRole: undefined,
        membershipPending: true,
      };
    }
    if (m) {
      organizationId = m.organizationId;
      orgRole = m.role;
    }
    return { organizationId, orgRole, membershipPending: false };
  }

  const live = await getMemberServer(organizationId, session.uid);
  if (live?.status === "pending") {
    return { organizationId, orgRole: undefined, membershipPending: true };
  }
  if (live?.status === "active" && live.role) {
    orgRole = live.role;
  }
  return { organizationId, orgRole, membershipPending: false };
}

/** Merges live membership into a session object for API responses and RSC props. */
export async function sessionWithLiveTenant(
  session: AppSession,
): Promise<AppSession> {
  const live = await resolveLiveTenantForSession(session);
  return {
    ...session,
    organizationId: live.organizationId,
    orgRole: live.orgRole,
  };
}
