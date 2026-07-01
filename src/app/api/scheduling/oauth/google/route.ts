import { NextResponse } from "next/server";
import { publicSiteOriginFromRequest } from "@/lib/auth/site-origin";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { upsertCalendarConnectionServer } from "@/lib/scheduling/calendar-connection-server";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "openid",
  "email",
].join(" ");

function redirectUri(origin: string): string {
  return `${origin}/api/scheduling/oauth/google`;
}

/** GET ?code=... → OAuth callback. GET without code → start OAuth (session required). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const origin = publicSiteOriginFromRequest(req);

  if (!code) {
    const g = await guardTenantApi();
    if (!g.ok) return g.response;

    const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Google Calendar is not configured. Add GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET to your environment.",
        },
        { status: 503 },
      );
    }

    const state = Buffer.from(
      JSON.stringify({
        uid: g.ctx.session.uid,
        orgId: g.ctx.session.organizationId,
      }),
    ).toString("base64url");

    const params = new URLSearchParams({
      client_id: clientId,
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

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      `${origin}/scheduling?calendar_error=not_configured`,
    );
  }

  let statePayload: { uid: string; orgId: string };
  try {
    const raw = url.searchParams.get("state") ?? "";
    statePayload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      uid: string;
      orgId: string;
    };
  } catch {
    return NextResponse.redirect(`${origin}/scheduling?calendar_error=invalid_state`);
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(`${origin}/scheduling?calendar_error=token_exchange`);
  }

  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  let accountEmail = "google-calendar";
  if (tokens.access_token) {
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (profileRes.ok) {
      const profile = (await profileRes.json()) as { email?: string };
      if (profile.email) accountEmail = profile.email;
    }
  }

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : undefined;

  await upsertCalendarConnectionServer({
    organizationId: statePayload.orgId,
    ownerUid: statePayload.uid,
    provider: "google",
    accountEmail,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    tokenExpiresAt: expiresAt,
  });

  return NextResponse.redirect(`${origin}/scheduling?calendar_connected=google`);
}
