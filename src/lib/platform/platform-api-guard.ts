import { NextResponse } from "next/server";
import type { Auth } from "@/lib/db/document-shim/shim-auth";
import { getAdminAuth } from "@/lib/db/document-access/admin";
import { getVerifiedSession, type AppSession } from "@/lib/auth/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import { isUserPlatformAdmin } from "@/lib/platform/check-platform-admin";

export type PlatformApiContext = {
  session: AppSession;
  /** Null when document store admin is unavailable. */
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
