import { headers } from "next/headers";
import { SITE } from "@/lib/site";
import { isClerkAuthV1Enabled } from "@/lib/auth/clerk-flags";

/** Build an absolute origin string for invite emails / setup links. */
export async function getRequestOrigin(): Promise<string> {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  try {
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? "https";
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) return `${proto}://${host}`;
  } catch {
    // headers() may not be available in some contexts
  }
  return SITE.url;
}

/** Signup/accept URL — Clerk `/sign-up` when `auth_clerk_v1` is on. */
export function inviteAcceptUrl(origin: string, token: string): string {
  const path = isClerkAuthV1Enabled() ? "/sign-up" : "/signup";
  return `${origin.replace(/\/$/, "")}${path}?invite=${encodeURIComponent(token)}`;
}

export function openJoinAcceptUrl(origin: string, token: string): string {
  const path = isClerkAuthV1Enabled() ? "/sign-up" : "/signup";
  return `${origin.replace(/\/$/, "")}${path}?join=${encodeURIComponent(token)}`;
}

export function authSignInPath(): string {
  return isClerkAuthV1Enabled() ? "/sign-in" : "/login";
}

export function authSignUpPath(): string {
  return isClerkAuthV1Enabled() ? "/sign-up" : "/signup";
}
