import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getAdminAuth } from "@/lib/firebase/admin";
import { isClerkAuthV1ServerEnabled } from "@/lib/auth/clerk-flags";
import { resolveClerkIdentity } from "@/lib/auth/clerk-identity";
import { setAppClaims } from "@/lib/auth/claims";

/**
 * P5.2 bridge: Clerk session → Firebase custom token for the linked Nova uid.
 * Client calls this then `signInWithCustomToken` so Firestore listeners work
 * until Firebase Auth is fully retired (P5.5 / P6).
 */
export async function POST() {
  if (!isClerkAuthV1ServerEnabled()) {
    return NextResponse.json(
      { error: "Clerk auth is not enabled." },
      { status: 404 },
    );
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const identity = await resolveClerkIdentity(user);
  // Mint even without an org (new Clerk user / invitee). Invite completion and
  // onboarding attach membership next; Firestore still needs a Firebase user.

  const adminAuth = getAdminAuth();
  if (!adminAuth) {
    return NextResponse.json(
      { error: "Firebase Admin is not configured." },
      { status: 503 },
    );
  }

  if (identity.organizationId) {
    try {
      await setAppClaims(adminAuth, identity.uid, {
        organizationId: identity.organizationId,
        orgRole: identity.orgRole,
        platformAdmin: identity.platformAdmin,
      });
    } catch (err) {
      console.warn(
        "[clerk-firebase-bridge] setAppClaims failed",
        err instanceof Error ? err.message : err,
      );
    }
  }

  try {
    const token = await adminAuth.createCustomToken(
      identity.uid,
      identity.organizationId
        ? {
            organizationId: identity.organizationId,
            orgRole: identity.orgRole,
            platformAdmin: identity.platformAdmin === true,
          }
        : undefined,
    );
    return NextResponse.json({
      token,
      uid: identity.uid,
      organizationId: identity.organizationId,
      orgRole: identity.orgRole ?? null,
      email: identity.email ?? null,
    });
  } catch (err) {
    console.error(
      "[clerk-firebase-bridge] createCustomToken failed",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: "Could not mint Firebase session token." },
      { status: 500 },
    );
  }
}
