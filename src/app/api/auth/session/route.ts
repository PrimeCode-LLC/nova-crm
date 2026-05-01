import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from "@/lib/auth/constants";

export async function POST(req: Request) {
  const adminAuth = getAdminAuth();
  if (!adminAuth) {
    return NextResponse.json(
      { error: "Firebase Admin is not configured. Set FIREBASE_ADMIN_* env vars." },
      { status: 503 },
    );
  }

  let body: { idToken?: string; company?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const idToken = body.idToken;
  const company =
    typeof body.company === "string" && body.company.trim()
      ? body.company.trim()
      : undefined;
  if (!idToken || typeof idToken !== "string") {
    return NextResponse.json({ error: "idToken is required" }, { status: 400 });
  }

  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    if (Date.now() / 1000 - decoded.auth_time > 60 * 60) {
      return NextResponse.json(
        { error: "ID token is too old. Sign in again." },
        { status: 401 },
      );
    }

    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE_MS,
    });

    const db = getAdminDb();
    if (db) {
      const ref = db.collection("users").doc(decoded.uid);
      const snap = await ref.get();
      const displayName =
        decoded.name ?? decoded.email?.split("@")[0] ?? "User";
      const payload: Record<string, unknown> = {
        email: decoded.email ?? null,
        displayName,
        status: "active",
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (company) payload.company = company;
      if (!snap.exists) {
        payload.createdAt = FieldValue.serverTimestamp();
        payload.roleId = "salesperson";
      }
      await ref.set(payload, { merge: true });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(SESSION_MAX_AGE_MS / 1000),
    });
    return res;
  } catch (e) {
    console.error("[auth/session]", e);
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }
}
