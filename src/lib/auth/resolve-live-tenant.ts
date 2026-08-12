import type { AppSession } from "@/lib/auth/server";
import type { OrgMemberRole } from "@/lib/types";
import {
  findMembershipByEmailServer,
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

/** Short in-process TTL - Fluid Compute reuses instances; cuts repeated Firestore fan-out. */
const TENANT_CACHE_TTL_MS = 30_000;
const tenantCache = new Map<
  string,
  { expiresAt: number; value: ResolvedTenantContext }
>();

function tenantCacheKey(
  session: Pick<AppSession, "uid" | "organizationId" | "orgRole">,
): string {
  return `${session.uid}:${session.organizationId ?? ""}:${session.orgRole ?? ""}`;
}

/**
 * Resolves the caller's tenant id and org role from Firestore membership,
 * preferring live data over JWT session-cookie claims (which can lag behind
 * admin role changes until the client re-exchanges the session).
 */
export async function resolveLiveTenantForSession(
  session: Pick<AppSession, "uid" | "email" | "organizationId" | "orgRole">,
): Promise<ResolvedTenantContext> {
  const key = tenantCacheKey(session);
  const hit = tenantCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const value = await resolveLiveTenantForSessionUncached(session);
  tenantCache.set(key, { expiresAt: Date.now() + TENANT_CACHE_TTL_MS, value });
  // Bound memory on long-lived Fluid instances
  if (tenantCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of tenantCache) {
      if (v.expiresAt <= now) tenantCache.delete(k);
    }
  }
  return value;
}

/** Test-only: drop the in-process TTL cache between cases. */
export function clearLiveTenantCacheForTests(): void {
  tenantCache.clear();
}

async function resolveLiveTenantForSessionUncached(
  session: Pick<AppSession, "uid" | "email" | "organizationId" | "orgRole">,
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
    if (!membership && session.email) {
      membership = await findMembershipByEmailServer(session.email);
    }
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
