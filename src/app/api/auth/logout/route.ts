import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { isClerkAuthV1ServerEnabled } from "@/lib/auth/clerk-flags";

export async function POST() {
  if (isClerkAuthV1ServerEnabled()) {
    try {
      const { sessionId } = await auth();
      if (sessionId) {
        const client = await clerkClient();
        await client.sessions.revokeSession(sessionId);
      }
    } catch (err) {
      console.warn(
        "[auth/logout] Clerk session revoke failed",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  // Legacy Firebase cookie name (pre-Clerk parallel) — clear if present.
  res.cookies.set("__session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
