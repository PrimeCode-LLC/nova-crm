import "server-only";

import { verifyToken } from "@clerk/backend";
import { clerkClient } from "@clerk/nextjs/server";
import { isClerkAuthV1ServerEnabled } from "@/lib/auth/clerk-flags";
import { resolveClerkIdentity } from "@/lib/auth/clerk-identity";
import type { OrgMemberRole } from "@/lib/types";

export type VerifiedClerkToken = {
  uid: string;
  email?: string;
  name?: string;
  authTimeMs: number;
  organizationId?: string;
  orgRole?: OrgMemberRole;
};

/** Verifies a Clerk session JWT (e.g. from the browser or Intent Radar extension). */
export async function verifyClerkSessionToken(
  token: string,
): Promise<VerifiedClerkToken | null> {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey || !isClerkAuthV1ServerEnabled()) return null;

  try {
    const payload = await verifyToken(token, { secretKey });
    const clerkUserId = payload.sub;
    if (!clerkUserId) return null;

    const client = await clerkClient();
    const user = await client.users.getUser(clerkUserId);
    const identity = await resolveClerkIdentity(user);
    const authTimeMs =
      typeof payload.iat === "number" ? payload.iat * 1000 : Date.now();

    return {
      uid: identity.uid,
      email: identity.email,
      name: identity.name,
      authTimeMs,
      organizationId: identity.organizationId,
      orgRole: identity.orgRole,
    };
  } catch {
    return null;
  }
}
