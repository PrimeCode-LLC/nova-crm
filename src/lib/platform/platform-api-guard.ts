import { NextResponse } from "next/server";
import type { Auth } from "firebase-admin/auth";
import { getAdminAuth } from "@/lib/firebase/admin";
import { getVerifiedSession, type AppSession } from "@/lib/auth/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import { isUserPlatformAdmin } from "@/lib/platform/check-platform-admin";

export type PlatformApiContext = {
  session: AppSession;
  /** Null when Firebase Admin is disabled / not configured. */
  adminAuth: Auth | null;
};

export type PlatformGuardResult =
  | { ok: true; ctx: PlatformApiContext }
  | { ok: false; response: NextResponse };

export async function guardPlatformApi(): Promise<PlatformGuardResult> {
  if (isAuthDisabled()) {
    return {
      ok: true,
      ctx: {
        session: { uid: "dev", email: "dev@local", name: "Dev user" },
        adminAuth: getAdminAuth(),
      },
    };
  }

  const session = await getVerifiedSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const allowed = await isUserPlatformAdmin(session.uid, session.email);
  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, ctx: { session, adminAuth: getAdminAuth() } };
}
