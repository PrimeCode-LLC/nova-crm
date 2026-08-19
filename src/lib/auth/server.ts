import { redirect } from "next/navigation";
import { isAuthDisabled } from "./flags";
import { isClerkAuthV1ServerEnabled } from "./clerk-flags";
import { getClerkAppSession } from "./clerk-session";
import { resolveLiveTenantForSession } from "./resolve-live-tenant";
import type { AppSession } from "./session-types";

export type { AppSession } from "./session-types";
export { isAuthDisabled } from "./flags";

/**
 * Verifies the active session (Clerk only — Firebase session cookies removed in P7).
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

  if (!isClerkAuthV1ServerEnabled()) {
    return null;
  }

  return getClerkAppSession();
}

export function authEntryPath(): string {
  return isClerkAuthV1ServerEnabled() ? "/sign-in" : "/login";
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
