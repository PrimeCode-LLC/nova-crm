"use client";

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

type GisTokenResponse = {
  access_token?: string;
  error?: string;
  expires_in?: number;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GisTokenResponse) => void;
          }) => { requestAccessToken: (overrides?: { prompt?: string }) => void };
        };
      };
    };
  }
}

function loadGisScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load Google Calendar sign-in.")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Google Calendar sign-in."));
    document.head.appendChild(script);
  });
}

async function resolveAccountEmail(accessToken: string): Promise<string> {
  try {
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (profileRes.ok) {
      const profile = (await profileRes.json()) as { email?: string };
      if (profile.email?.trim()) return profile.email.trim();
    }
  } catch {
    /* ignore */
  }
  return "google-calendar";
}

/**
 * Calendar-only Google OAuth (GIS). Does not change Nova login — pick any Google account.
 * Requires a public OAuth client id (NEXT_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID or server-exposed id).
 */
export async function connectGoogleCalendarGis(clientId: string): Promise<{
  accessToken: string;
  accountEmail: string;
  expiresInSec: number;
}> {
  const id = clientId.trim();
  if (!id) {
    throw new Error("Google Calendar client id is not configured.");
  }

  await loadGisScript();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: CALENDAR_SCOPES,
      callback: (response) => {
        void (async () => {
          if (response.error) {
            if (response.error === "popup_closed_by_user") {
              finish(() => reject(new Error("Calendar connection was cancelled.")));
              return;
            }
            finish(() => reject(new Error(response.error ?? "Google Calendar authorization failed.")));
            return;
          }
          const accessToken = response.access_token?.trim();
          if (!accessToken) {
            finish(() =>
              reject(new Error("Google did not return calendar access. Approve calendar permissions and try again.")),
            );
            return;
          }
          const accountEmail = await resolveAccountEmail(accessToken);
          const expiresInSec =
            typeof response.expires_in === "number" && response.expires_in > 0 ? response.expires_in : 3600;
          finish(() => resolve({ accessToken, accountEmail, expiresInSec }));
        })();
      },
    });

    try {
      client.requestAccessToken({ prompt: "consent" });
    } catch (e: unknown) {
      finish(() =>
        reject(e instanceof Error ? e : new Error("Could not open Google Calendar authorization.")),
      );
    }
  });
}
