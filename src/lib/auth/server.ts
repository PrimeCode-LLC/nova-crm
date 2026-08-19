import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAuth } from "@/lib/db/document-access/admin";
import { SESSION_COOKIE_NAME } from "./constants";
import { isAuthDisabled } from "./flags";
import { isClerkAuthV1Enabled } from "./clerk-flags";
import { readAppClaims } from "./claims";
import { getClerkAppSession } from "./clerk-session";
import { resolveLiveTenantForSession } from "./resolve-live-tenant";
import type { AppSession } from "./session-types";

export type { AppSession } from "./session-types";
export { isAuthDisabled } from "./flags";

/** Short in-process cache of verified session cookies (Fluid Compute warm instances). */
const SESSION_CACHE_TTL_MS = 30_000;
const sessionCache = new Map<string, { expiresAt: number; session: AppSession }>();

async function getAppSession(): Promise<AppSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const cached = sessionCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.session;

  const adminAuth = getAdminAuth();
  if (!adminAuth) return null;

  try {
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

/**
 * Verifies Clerk and/or Firebase `__nova_session`.
 * P5.3: when Clerk is enabled, prefer Clerk (Firebase cookie is secondary / bridge).
 */
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

  if (isClerkAuthV1Enabled()) {
    const clerk = await getClerkAppSession();
    if (clerk) return clerk;
    return getAppSession();
  }

  return getAppSession();
}

export function authEntryPath(): string {
  return isClerkAuthV1Enabled() ? "/sign-in" : "/login";
}

export async function requireSession(): Promise<AppSession> {
  const session = await getVerifiedSession();
  if (!session) {
    redirect(authEntryPath());
  }
  return session;
}

/**
 * Server pages that touch tenant data should call this - it short-circuits
 * to `/onboarding` when a signed-in user has no organization yet.
 * P5.3: resolves live membership (email / uid) so Clerk sessions get org context.
 */
export async function requireTenantSession(): Promise<
  AppSession & { organizationId: string }
> {
  const session = await requireSession();
  const live = await resolveLiveTenantForSession(session);
  if (live.membershipPending) {
    redirect("/join/pending");
  }
  if (live.accessDeniedReason === "inactive_user") {
    redirect(authEntryPath());
  }
  if (!live.organizationId) {
    redirect("/onboarding");
  }
  return {
    ...session,
    organizationId: live.organizationId,
    orgRole: live.orgRole ?? session.orgRole,
  };
}
