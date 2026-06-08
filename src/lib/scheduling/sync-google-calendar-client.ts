"use client";

import {
  connectGoogleCalendarClient,
  isGoogleCalendarConnectRedirect,
} from "@/lib/scheduling/connect-google-calendar-client";
import { formatFirebaseAuthError } from "@/lib/firebase/auth-errors";

export type CalendarSyncResponse =
  | {
      ok: true;
      eventCount: number;
      needsReconnect?: boolean;
      lastSyncAt?: string;
    }
  | {
      ok: false;
      needsReconnect?: boolean;
      /** Browser is navigating to Google OAuth (server redirect flow). */
      redirecting?: boolean;
      error?: string;
    };

async function postSync(hostId?: string): Promise<CalendarSyncResponse> {
  const res = await fetch("/api/scheduling/calendar-connections/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(hostId ? { hostId } : {}),
  });
  return (await res.json()) as CalendarSyncResponse;
}

async function resolveGoogleConnectConfig(): Promise<{
  googleMethod: "firebase" | "oauth" | "gis" | "none";
  googleCalendarClientId?: string;
}> {
  try {
    const res = await fetch("/api/scheduling/context");
    const j = (await res.json()) as {
      ok?: boolean;
      oauth?: { googleMethod?: string; googleCalendarClientId?: string };
    };
    if (!j.ok) return { googleMethod: "none" };
    const method = j.oauth?.googleMethod;
    const googleMethod =
      method === "oauth" || method === "gis" || method === "firebase" ? method : "none";
    return {
      googleMethod,
      googleCalendarClientId: j.oauth?.googleCalendarClientId,
    };
  } catch {
    return { googleMethod: "none" };
  }
}

async function saveGoogleAccessToken(tokens: {
  accessToken: string;
  accountEmail: string;
  expiresInSec: number;
}): Promise<boolean> {
  const res = await fetch("/api/scheduling/calendar-connections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "google",
      accessToken: tokens.accessToken,
      accountEmail: tokens.accountEmail,
      expiresInSec: tokens.expiresInSec,
    }),
  });
  const j = await res.json();
  return Boolean(j.ok);
}

/** Sync Google Calendar events; refreshes access via popup when the stored token expired. */
export async function syncGoogleCalendarClient(input?: {
  hostId?: string;
  /** When true, always re-authenticate with Google before syncing. */
  forceRefresh?: boolean;
}): Promise<CalendarSyncResponse & { refreshedAccess?: boolean; redirecting?: boolean }> {
  if (!input?.forceRefresh) {
    const first = await postSync(input?.hostId);
    if (first.ok || !first.needsReconnect) return first;
  }

  const connectConfig = await resolveGoogleConnectConfig();

  try {
    const connectResult = await connectGoogleCalendarClient({
      googleMethod: connectConfig.googleMethod,
      googleCalendarClientId: connectConfig.googleCalendarClientId,
      preferAnyGoogleAccount: true,
    });
    if (isGoogleCalendarConnectRedirect(connectResult)) {
      return { ok: false, needsReconnect: true, redirecting: true };
    }
    const tokens = connectResult;
    const saved = await saveGoogleAccessToken(tokens);
    if (!saved) {
      return { ok: false, error: "Could not save refreshed Google Calendar access." };
    }
    const second = await postSync(input?.hostId);
    return { ...second, refreshedAccess: true };
  } catch (e: unknown) {
    return { ok: false, error: formatFirebaseAuthError(e) };
  }
}
