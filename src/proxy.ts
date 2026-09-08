import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { isAuthDisabled } from "@/lib/auth/flags";

const APP_PROTECTED_PREFIXES = [
  "/join",
  "/dashboard",
  "/leads",
  "/prospects",
  "/pipeline",
  "/accounts",
  "/contacts",
  "/deals",
  "/activity",
  "/followups",
  "/replies",
  "/scheduling",
  "/tasks",
  "/content",
  "/scripts",
  "/outreach",
  "/fit-check",
  "/intake",
  "/my-strategy",
  "/inbox",
  "/notifications",
  "/team-chat",
  "/admin",
  "/settings",
  "/actions",
  "/platform",
];

function isProtectedAppPath(pathname: string): boolean {
  return APP_PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function proxy(request: NextRequest) {
  if (isAuthDisabled()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  // Intentionally do NOT redirect /login|/signup → /dashboard based only on cookie
  // presence. An unverifiable/stale cookie (including Clerk leftovers named
  // `__session` before we renamed) caused an infinite 307 loop with requireSession().
  // Valid sessions are sent to the app after login/session exchange instead.

  if (!hasSession && isProtectedAppPath(pathname)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    const res = NextResponse.redirect(login);
    // Drop legacy Clerk/Firebase cookie name that used to collide with Nova's session cookie.
    if (request.cookies.get("__session")?.value) {
      res.cookies.set("__session", "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
    }
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
