import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAuth } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME } from "./constants";
import { isAuthDisabled } from "./flags";

export { isAuthDisabled } from "./flags";

export type AppSession = {
  uid: string;
  email?: string;
  name?: string;
};

/** Verifies the httpOnly session cookie. Returns null if missing/invalid. */
export async function getVerifiedSession(): Promise<AppSession | null> {
  if (isAuthDisabled()) {
    return { uid: "dev", email: "dev@local", name: "Dev user" };
  }

  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const adminAuth = getAdminAuth();
  if (!adminAuth) return null;

  try {
    const decoded = await adminAuth.verifySessionCookie(token, true);
    return {
      uid: decoded.uid,
      email: decoded.email ?? undefined,
      name: decoded.name ?? undefined,
    };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<AppSession> {
  const session = await getVerifiedSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}
