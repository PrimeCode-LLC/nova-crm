import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAuth } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME } from "./constants";
import { isAuthDisabled } from "./flags";
import { readAppClaims } from "./claims";
import type { OrgMemberRole } from "@/lib/types";

export { isAuthDisabled } from "./flags";

export type AppSession = {
  uid: string;
  email?: string;
  name?: string;
  organizationId?: string;
  orgRole?: OrgMemberRole;
  platformAdmin?: boolean;
};

/** Short in-process cache of verified session cookies (Fluid Compute warm instances). */
const SESSION_CACHE_TTL_MS = 30_000;
const sessionCache = new Map<string, { expiresAt: number; session: AppSession }>();

/** Verifies the httpOnly session cookie. Returns null if missing/invalid. */
export async function getVerifiedSession(): Promise<AppSession | null> {
  if (isAuthDisabled()) {
    return {
      uid: "dev",
      email: "dev@local",
      name: "Dev user",
      organizationId: "dev-org",
      orgRole: "owner",
      platformAdmin: true,
    };
  }

  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const cached = sessionCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.session;

  const adminAuth = getAdminAuth();
  if (!adminAuth) return null;

  try {
    // checkRevoked=false: rely on cookie expiry + 30s cache; avoids Auth round-trip every API call.
    const decoded = await adminAuth.verifySessionCookie(token, false);
    const claims = readAppClaims(decoded as unknown as Record<string, unknown>);
    const session: AppSession = {
      uid: decoded.uid,
      email: decoded.email ?? undefined,
      name: decoded.name ?? undefined,
      organizationId: claims.organizationId,
      orgRole: claims.orgRole,
      platformAdmin: claims.platformAdmin,
    };
    sessionCache.set(token, { expiresAt: Date.now() + SESSION_CACHE_TTL_MS, session });
    if (sessionCache.size > 500) {
      const now = Date.now();
      for (const [k, v] of sessionCache) {
        if (v.expiresAt <= now) sessionCache.delete(k);
      }
    }
    return session;
  } catch {
    sessionCache.delete(token);
    return null;
  }
}

export async function requireSession(): Promise<AppSession> {
  const session = await getVerifiedSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

/**
 * Server pages that touch tenant data should call this — it short-circuits
 * to `/onboarding` when a signed-in user has no organization yet.
 */
export async function requireTenantSession(): Promise<
  AppSession & { organizationId: string }
> {
  const session = await requireSession();
  if (!session.organizationId) {
    redirect("/onboarding");
  }
  return session as AppSession & { organizationId: string };
}
