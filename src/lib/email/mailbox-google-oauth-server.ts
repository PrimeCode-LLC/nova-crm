import {
  getMailboxSecretsServer,
  patchMailboxGoogleAccessTokenServer,
} from "@/lib/email/mailbox-secrets-server";

function googleOAuthClientCreds(): { clientId: string; clientSecret: string } | null {
  const clientId =
    process.env.GOOGLE_MAIL_CLIENT_ID?.trim() ||
    process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() ||
    "";
  const clientSecret =
    process.env.GOOGLE_MAIL_CLIENT_SECRET?.trim() ||
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() ||
    "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export async function refreshGoogleMailAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt: string;
} | null> {
  const creds = googleOAuthClientCreds();
  if (!creds) return null;
  if (!refreshToken.trim()) return null;

  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cause =
      err instanceof Error && err.cause instanceof Error
        ? err.cause.message
        : err instanceof Error && err.cause != null
          ? String(err.cause)
          : undefined;
    console.warn("[google-mail-oauth] refresh fetch failed:", { message, cause });
    return null;
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string; error_description?: string };
      detail = [body.error, body.error_description].filter(Boolean).join(": ");
    } catch {
      detail = `HTTP ${res.status}`;
    }
    console.warn("[google-mail-oauth] refresh failed:", detail || res.status);
    return null;
  }
  const tokens = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!tokens.access_token) return null;
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : new Date(Date.now() + 3600 * 1000).toISOString();
  return { accessToken: tokens.access_token, expiresAt };
}

export type GoogleMailAuthFailureReason =
  | "not_configured"
  | "no_tokens"
  | "no_account_email"
  | "refresh_failed"
  | "expired";

/**
 * Returns a fresh access token for Google Workspace IMAP/SMTP (XOAUTH2), or null if not connected.
 * When `detail` is provided, sets a machine-readable failure reason for API error messages.
 */
export async function resolveMailboxGoogleAccessTokenServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  detail?: { reason?: GoogleMailAuthFailureReason };
}): Promise<{ user: string; accessToken: string } | null> {
  if (!input.mailboxId.trim()) return null;
  const secrets = await getMailboxSecretsServer(input);
  const oauth = secrets?.googleOAuth;
  if (!oauth?.refreshToken && !oauth?.accessToken) {
    if (input.detail) input.detail.reason = "no_tokens";
    return null;
  }

  const user =
    oauth.accountEmail.trim() ||
    secrets?.smtp.user.trim() ||
    secrets?.imap.user.trim() ||
    "";
  if (!user) {
    if (input.detail) input.detail.reason = "no_account_email";
    return null;
  }

  const now = Date.now();
  const expiresMs = oauth.tokenExpiresAt ? new Date(oauth.tokenExpiresAt).getTime() : 0;
  const stillValid = Boolean(oauth.accessToken) && expiresMs > now + 60_000;
  if (stillValid && oauth.accessToken) {
    return { user, accessToken: oauth.accessToken };
  }

  if (oauth.refreshToken) {
    if (!googleOAuthClientCreds()) {
      if (input.detail) input.detail.reason = "not_configured";
      return null;
    }
    const refreshed = await refreshGoogleMailAccessToken(oauth.refreshToken);
    if (refreshed) {
      await patchMailboxGoogleAccessTokenServer({
        ...input,
        accessToken: refreshed.accessToken,
        tokenExpiresAt: refreshed.expiresAt,
      });
      return { user, accessToken: refreshed.accessToken };
    }
    if (input.detail) input.detail.reason = "refresh_failed";
  }

  if (oauth.accessToken) {
    const probe = await fetch(
      `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(oauth.accessToken)}`,
    );
    if (probe.ok) return { user, accessToken: oauth.accessToken };
  }

  if (input.detail && !input.detail.reason) input.detail.reason = "expired";
  return null;
}

export function googleMailOAuthConfigured(): boolean {
  return googleOAuthClientCreds() != null;
}

export { googleOAuthClientCreds };
