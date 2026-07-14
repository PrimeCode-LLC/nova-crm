import { NextResponse } from "next/server";
import { publicSiteOriginFromRequest } from "@/lib/auth/site-origin";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  googleMailOAuthConfigured,
  googleOAuthClientCreds,
} from "@/lib/email/mailbox-google-oauth-server";
import { upsertMailboxGoogleOAuthServer } from "@/lib/email/mailbox-secrets-server";
import {
  applyGoogleWorkspacePreset,
  withGoogleWorkspaceConnection,
} from "@/lib/email/mailbox-connection-presets";
import {
  getMailboxProfileServer,
  upsertMailboxProfileServer,
} from "@/lib/email/mailbox-profiles-server";
import { defaultEmailMailboxSettings } from "@/lib/email-account-types";

/** Full mail scope required for Gmail IMAP/SMTP XOAUTH2. */
const SCOPES = ["https://mail.google.com/", "openid", "email"].join(" ");

function redirectUri(origin: string): string {
  return `${origin}/api/email/oauth/google`;
}

/**
 * GET without code → start OAuth (requires session + mailboxId query).
 * GET ?code=… → OAuth callback; redirects back to Settings → Email.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const origin = publicSiteOriginFromRequest(req);

  if (!code) {
    const g = await guardTenantApi();
    if (!g.ok) return g.response;

    if (!googleMailOAuthConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Google mail OAuth is not configured. Add GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET (or GOOGLE_MAIL_*), and register redirect URI /api/email/oauth/google with the mail.google.com scope.",
        },
        { status: 503 },
      );
    }

    const mailboxId = url.searchParams.get("mailboxId")?.trim() ?? "";
    if (!mailboxId) {
      return NextResponse.json({ ok: false, error: "mailboxId is required" }, { status: 400 });
    }

    const creds = googleOAuthClientCreds()!;
    const state = Buffer.from(
      JSON.stringify({
        uid: g.ctx.session.uid,
        orgId: g.ctx.session.organizationId,
        mailboxId,
      }),
    ).toString("base64url");

    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri(origin),
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
      state,
    });

    return NextResponse.redirect(
      `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    );
  }

  const creds = googleOAuthClientCreds();
  if (!creds) {
    return NextResponse.redirect(`${origin}/settings?tab=email&google_mail_error=not_configured`);
  }

  let statePayload: { uid: string; orgId: string; mailboxId: string };
  try {
    const raw = url.searchParams.get("state") ?? "";
    statePayload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      uid: string;
      orgId: string;
      mailboxId: string;
    };
  } catch {
    return NextResponse.redirect(`${origin}/settings?tab=email&google_mail_error=invalid_state`);
  }

  if (!statePayload.mailboxId?.trim()) {
    return NextResponse.redirect(`${origin}/settings?tab=email&google_mail_error=invalid_state`);
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(`${origin}/settings?tab=email&google_mail_error=token_exchange`);
  }

  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!tokens.access_token) {
    return NextResponse.redirect(`${origin}/settings?tab=email&google_mail_error=token_exchange`);
  }

  let accountEmail = "";
  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (profileRes.ok) {
    const profile = (await profileRes.json()) as { email?: string };
    accountEmail = profile.email?.trim() ?? "";
  }
  if (!accountEmail) {
    return NextResponse.redirect(`${origin}/settings?tab=email&google_mail_error=no_email`);
  }

  const existing = await getMailboxProfileServer({
    organizationId: statePayload.orgId,
    uid: statePayload.uid,
    mailboxId: statePayload.mailboxId,
  });

  const base =
    existing ??
    defaultEmailMailboxSettings({
      id: statePayload.mailboxId,
      label: accountEmail,
      enabled: true,
    });

  const withGoogle = withGoogleWorkspaceConnection({
    ...base,
    emailAddress: accountEmail || base.emailAddress,
    displayName: base.displayName || accountEmail.split("@")[0] || base.displayName,
    enabled: true,
  });
  const hosts = applyGoogleWorkspacePreset({
    ...withGoogle,
    emailAddress: accountEmail,
  });

  await upsertMailboxProfileServer({
    organizationId: statePayload.orgId,
    uid: statePayload.uid,
    mailbox: {
      ...withGoogle,
      ...hosts,
      smtp: { ...hosts.smtp, password: "" },
      imap: { ...hosts.imap, password: "" },
    },
  });

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : new Date(Date.now() + 3600 * 1000).toISOString();

  const oauthResult = await upsertMailboxGoogleOAuthServer({
    organizationId: statePayload.orgId,
    uid: statePayload.uid,
    mailboxId: statePayload.mailboxId,
    googleOAuth: {
      refreshToken: tokens.refresh_token ?? "",
      accessToken: tokens.access_token,
      tokenExpiresAt: expiresAt,
      accountEmail,
    },
  });

  if ("error" in oauthResult) {
    return NextResponse.redirect(`${origin}/settings?tab=email&google_mail_error=vault`);
  }

  if (!tokens.refresh_token) {
    return NextResponse.redirect(
      `${origin}/settings?tab=email&google_mail_connected=1&google_mail_warning=no_refresh`,
    );
  }

  return NextResponse.redirect(`${origin}/settings?tab=email&google_mail_connected=1`);
}
