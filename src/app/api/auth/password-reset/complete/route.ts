import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

const MIN_PASSWORD_LENGTH = 8;

type IdentityToolkitResetResponse = {
  email?: string;
  localId?: string;
  error?: { message?: string; errors?: unknown };
};

function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

function mapFirebaseResetError(message: string | undefined): string {
  switch (message) {
    case "INVALID_OOB_CODE":
    case "EXPIRED_OOB_CODE":
      return "This reset link is invalid or has expired. Request a new one.";
    case "USER_DISABLED":
      return "This account has been disabled.";
    case "WEAK_PASSWORD":
      return "Password is too weak. Use at least 8 characters.";
    default:
      return "Could not reset password. Try again or request a new link.";
  }
}

/**
 * Applies the new password via Firebase Identity Toolkit (server-side), revokes
 * refresh tokens, clears the app session cookie, and does not mint a new session.
 */
export async function POST(req: Request) {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Firebase API key is not configured." },
      { status: 503 },
    );
  }

  let body: { oobCode?: string; newPassword?: string };
  try {
    body = (await req.json()) as { oobCode?: string; newPassword?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const oobCode = typeof body.oobCode === "string" ? body.oobCode.trim() : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!oobCode || !newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      {
        ok: false,
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      },
      { status: 400 },
    );
  }

  const resetUrl = `https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${encodeURIComponent(apiKey)}`;
  let resetJson: IdentityToolkitResetResponse;
  try {
    const resetRes = await fetch(resetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oobCode, newPassword }),
    });
    resetJson = (await resetRes.json()) as IdentityToolkitResetResponse;
    if (!resetRes.ok) {
      const msg = resetJson.error?.message;
      return NextResponse.json(
        { ok: false, error: mapFirebaseResetError(msg) },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not reach authentication service." },
      { status: 502 },
    );
  }

  const uid = resetJson.localId;
  const adminAuth = getAdminAuth();
  if (uid && adminAuth) {
    try {
      await adminAuth.revokeRefreshTokens(uid);
    } catch {
      /* password change already invalidates tokens; best-effort */
    }
  }

  const res = NextResponse.json({
    ok: true,
    redirect: "/login?reset=complete",
  });
  clearSessionCookie(res);
  return res;
}
