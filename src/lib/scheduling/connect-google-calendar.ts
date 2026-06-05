"use client";

import {
  GoogleAuthProvider,
  reauthenticateWithPopup,
} from "firebase/auth";

import { getFirebaseAuth } from "@/lib/firebase/client";

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

export function buildGoogleCalendarProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  for (const scope of CALENDAR_SCOPES) {
    provider.addScope(scope);
  }
  provider.setCustomParameters({ prompt: "consent" });
  return provider;
}

/** Uses the same Google account as Firebase login; no separate OAuth env vars required. */
export async function connectGoogleCalendarPopup(): Promise<{
  accessToken: string;
  accountEmail: string;
  expiresInSec: number;
}> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Sign in to Nova first, then connect your calendar.");
  }

  const provider = buildGoogleCalendarProvider();
  const result = await reauthenticateWithPopup(user, provider);
  const cred = GoogleAuthProvider.credentialFromResult(result);
  if (!cred?.accessToken) {
    throw new Error("Google did not return calendar access. Try again and approve calendar permissions.");
  }

  const accountEmail = result.user.email ?? user.email ?? "google-calendar";
  return {
    accessToken: cred.accessToken,
    accountEmail,
    expiresInSec: 3600,
  };
}
