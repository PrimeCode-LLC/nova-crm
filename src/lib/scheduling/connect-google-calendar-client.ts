"use client";

import { connectGoogleCalendarGis } from "@/lib/scheduling/connect-google-calendar-gis";
import {
  connectGoogleCalendarPopup,
  redirectToGoogleCalendarOAuth,
} from "@/lib/scheduling/connect-google-calendar";
import { resolvePublicGoogleCalendarClientId } from "@/lib/scheduling/resolve-google-calendar-client-id";

export type GoogleCalendarConnectMethod = "oauth" | "gis" | "firebase";

export type GoogleCalendarTokens = {
  accessToken: string;
  accountEmail: string;
  expiresInSec: number;
};

export function isGoogleCalendarConnectRedirect(
  result: GoogleCalendarTokens | { redirecting: true },
): result is { redirecting: true } {
  return "redirecting" in result && result.redirecting === true;
}

/**
 * Connect Google Calendar for the signed-in Nova user.
 * Nova login and Google Calendar can be different accounts when using OAuth redirect or GIS.
 */
export async function connectGoogleCalendarClient(input: {
  googleMethod?: GoogleCalendarConnectMethod | "none";
  googleCalendarClientId?: string | null;
  /** Prefer GIS / redirect so the user can pick any Google account. */
  preferAnyGoogleAccount?: boolean;
}): Promise<GoogleCalendarTokens | { redirecting: true }> {
  const method = input.googleMethod ?? "firebase";
  const clientId = resolvePublicGoogleCalendarClientId(input.googleCalendarClientId);
  const preferAny = input.preferAnyGoogleAccount !== false;

  if (preferAny && method === "oauth") {
    redirectToGoogleCalendarOAuth();
    return { redirecting: true };
  }

  if (preferAny && clientId) {
    return connectGoogleCalendarGis(clientId);
  }

  return connectGoogleCalendarPopup();
}

export { redirectToGoogleCalendarOAuth };
