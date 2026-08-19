import type { Auth } from "firebase-admin/auth";
import { NextResponse } from "next/server";

/** Return a 503 response when a route still needs Firebase Auth Admin. */
export function firebaseAdminRequiredResponse(
  adminAuth: Auth | null,
): NextResponse | null {
  if (adminAuth) return null;
  return NextResponse.json(
    {
      error:
        "This action requires Firebase Admin. Unset FIREBASE_DISABLED and configure FIREBASE_ADMIN_*, or use Clerk-only flows.",
      code: "firebase_admin_required",
    },
    { status: 503 },
  );
}
