import type { AppSession } from "@/lib/auth/server";
import type { OrgMemberRole } from "@/lib/types";
import {
  findMembershipForUserServer,
  getMemberServer,
} from "@/lib/platform/members-server";
import { getOrganizationServer } from "@/lib/platform/organizations-server";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";

export type ResolvedTenantContext = {
  organizationId?: string;
  orgRole?: OrgMemberRole;
  membershipPending: boolean;
  accessDeniedReason?:
    | "inactive_user"
    | "inactive_membership"
    | "suspended_organization";
};

/**
 * Resolves the caller's tenant id and org role from Firestore membership,
 * preferring live data over JWT session-cookie claims (which can lag behind
 * admin role changes until the client re-exchanges the session).
 */
export async function resolveLiveTenantForSession(
  session: Pick<AppSession, "uid" | "organizationId" | "orgRole">,
): Promise<ResolvedTenantContext> {
  const db = getAdminDb();
  const userSnap = await db?.collection(COLLECTIONS.users).doc(session.uid).get();
  const userStatus = userSnap?.data()?.status;
  if (userStatus === "inactive") {
    return {
      membershipPending: false,
      accessDeniedReason: "inactive_user",
    };
  }

  let organizationId = session.organizationId;
  let membership = organizationId
    ? await getMemberServer(organizationId, session.uid)
    : null;

  if (!membership) {
    membership = await findMembershipForUserServer(session.uid);
    if (membership?.status === "pending") {
      return {
        organizationId: membership.organizationId,
        orgRole: undefined,
        membershipPending: true,
      };
    }
  }

  if (!membership || membership.status !== "active") {
    return {
      membershipPending: false,
      accessDeniedReason: "inactive_membership",
    };
  }

  organizationId = membership.organizationId;
  const organization = await getOrganizationServer(organizationId);
  if (!organization || organization.status === "suspended") {
    return {
      membershipPending: false,
      accessDeniedReason: "suspended_organization",
    };
  }

  return {
    organizationId,
    orgRole: membership.role,
    membershipPending: false,
  };
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
