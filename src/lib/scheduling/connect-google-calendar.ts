"use client";

import {
  GoogleAuthProvider,
  linkWithPopup,
  reauthenticateWithPopup,
  type UserCredential,
} from "@/lib/db/document-shim/shim-client-auth";

import { readAuthErrorCode } from "@/lib/db/document-access/auth-errors";
import { getClientAuth } from "@/lib/db/document-access/client";

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

export function buildGoogleCalendarProvider(loginHint?: string): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  for (const scope of CALENDAR_SCOPES) {
    provider.addScope(scope);
  }
  const custom: Record<string, string> = { prompt: "consent" };
  if (loginHint?.trim()) custom.login_hint = loginHint.trim();
  provider.setCustomParameters(custom);
  return provider;
}

function credentialFromPopupResult(result: UserCredential): { accessToken: string } {
  const cred = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = cred?.accessToken;
  if (!accessToken) {
    throw new Error("Google did not return calendar access. Try again and approve calendar permissions.");
  }
  return { accessToken };
}

function userSignedInWithGoogle(user: { providerData: { providerId: string }[] }): boolean {
  return user.providerData.some((p) => p.providerId === "google.com");
}

/**
 * Firebase Google flow for calendar scopes.
 * - Google sign-in users: reauthenticate with the same Google account.
 * - Email/password users: link Google (avoids auth/user-mismatch from reauthenticateWithPopup).
 */
export async function connectGoogleCalendarPopup(): Promise<{
  accessToken: string;
  accountEmail: string;
  expiresInSec: number;
}> {
  const auth = getClientAuth();
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Sign in to Nova first, then connect your calendar.");
  }

  const loginHint = user.email ?? undefined;
  const provider = buildGoogleCalendarProvider(loginHint);
  let result: UserCredential;

  if (userSignedInWithGoogle(user)) {
    try {
      result = await reauthenticateWithPopup(user, provider);
    } catch (e: unknown) {
      if (readAuthErrorCode(e) === "auth/user-mismatch") {
        throw new Error(
          loginHint
            ? `Choose the same Google account you use for Nova (${loginHint}) when Google prompts you.`
            : "Choose the same Google account you used to sign in to Nova.",
        );
      }
      throw e;
    }
  } else {
    try {
      result = await linkWithPopup(user, provider);
    } catch (e: unknown) {
      const code = readAuthErrorCode(e);
      if (code === "auth/provider-already-linked") {
        result = await reauthenticateWithPopup(user, provider);
      } else if (code === "auth/credential-already-in-use") {
        throw new Error(
          "This Google account is already linked to another Nova user. Sign in with that account, or pick a different Google account.",
        );
      } else if (code === "auth/user-mismatch") {
        throw new Error(
          "That Google account does not match your Nova session. Sign out, sign back in, then connect calendar again.",
        );
      } else {
        throw e;
      }
    }
  }

  const cred = credentialFromPopupResult(result);
  const accountEmail = result.user.email ?? user.email ?? "google-calendar";
  return {
    accessToken: cred.accessToken,
    accountEmail,
    expiresInSec: 3600,
  };
}

/** Server OAuth redirect - works with any Google account; supports refresh tokens. */
export function redirectToGoogleCalendarOAuth(): void {
  window.location.href = "/api/scheduling/oauth/google";
}
