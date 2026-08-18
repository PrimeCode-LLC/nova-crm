import { auth, currentUser } from "@clerk/nextjs/server";
import { isClerkAuthV1ServerEnabled } from "@/lib/auth/clerk-flags";
import { resolveClerkIdentity } from "@/lib/auth/clerk-identity";
import type { AppSession } from "@/lib/auth/session-types";

/**
 * Builds an AppSession from the Clerk cookie when `auth_clerk_v1` is on.
 * P5.2: maps Clerk user → Nova uid / organization via externalId + email bridge.
 */
export async function getClerkAppSession(): Promise<AppSession | null> {
  if (!isClerkAuthV1ServerEnabled()) return null;

  const { userId } = await auth();
  if (!userId) return null;

  const user = await currentUser();
  if (!user) {
    return { uid: userId };
  }

  const identity = await resolveClerkIdentity(user);
  return {
    uid: identity.uid,
    email: identity.email,
    name: identity.name,
    organizationId: identity.organizationId,
    orgRole: identity.orgRole,
    platformAdmin: identity.platformAdmin,
  };
}
