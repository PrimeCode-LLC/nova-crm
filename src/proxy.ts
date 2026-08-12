import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { isAuthDisabled } from "@/lib/auth/flags";
import {
  isClerkAuthV1Enabled,
  isClerkAuthV1ServerEnabled,
} from "@/lib/auth/clerk-flags";

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

const AUTH_ENTRY_PATHS = new Set([
  "/login",
  "/signup",
  "/sign-in",
  "/sign-up",
]);

function isProtectedAppPath(pathname: string): boolean {
  return APP_PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isAuthEntryPath(pathname: string): boolean {
  if (AUTH_ENTRY_PATHS.has(pathname)) return true;
  return (
    pathname.startsWith("/sign-in/") || pathname.startsWith("/sign-up/")
  );
}

/**
 * Shared gate: Firebase `__nova_session` and/or Clerk userId (when flag on).
 * Does not call auth.protect — resource routes still use requireSession.
 */
function applySessionGate(
  request: NextRequest,
  clerkUserId: string | null,
): NextResponse {
  if (isAuthDisabled()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const hasFirebaseSession = Boolean(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );
  const hasSession = hasFirebaseSession || Boolean(clerkUserId);

  const hasInvite = request.nextUrl.searchParams.has("invite");
  const hasJoin = request.nextUrl.searchParams.has("join");
  if (hasSession && !hasInvite && !hasJoin && isAuthEntryPath(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (!hasSession && isProtectedAppPath(pathname)) {
    const loginPath = isClerkAuthV1Enabled() ? "/sign-in" : "/login";
    const login = new URL(loginPath, request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

const clerkEnabled = isClerkAuthV1ServerEnabled();

const proxyHandler = clerkEnabled
  ? clerkMiddleware(async (auth, request) => {
      const { userId } = await auth();
      return applySessionGate(request, userId);
    })
  : function proxy(request: NextRequest) {
      return applySessionGate(request, null);
    };

export default proxyHandler;

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
