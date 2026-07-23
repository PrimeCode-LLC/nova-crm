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

  // Don't bounce off /signup if there's an invite token to honor.
  const hasInvite = request.nextUrl.searchParams.has("invite");
  const hasJoin = request.nextUrl.searchParams.has("join");
  if (
    hasSession &&
    !hasInvite &&
    !hasJoin &&
    (pathname === "/login" || pathname === "/signup")
  ) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (!hasSession && isProtectedAppPath(pathname)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
