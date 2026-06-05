import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  disconnectCalendarConnectionServer,
  listCalendarConnectionsServer,
  updateCalendarConnectionSettingsServer,
  upsertCalendarConnectionServer,
} from "@/lib/scheduling/calendar-connection-server";

const connectGoogleSchema = z.object({
  provider: z.literal("google"),
  accessToken: z.string().min(1),
  accountEmail: z.string().min(1),
  expiresInSec: z.number().int().positive().optional(),
});

const patchSchema = z.object({
  id: z.string().min(1),
  includeBuffers: z.boolean().optional(),
  syncExternalChanges: z.boolean().optional(),
});

export async function GET() {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const items = await listCalendarConnectionsServer({
    organizationId: g.ctx.session.organizationId,
    ownerUid: g.ctx.session.uid,
  });
  return NextResponse.json({ ok: true, items });
}

/** Connect Google Calendar via Firebase popup access token (no dedicated OAuth env vars). */
export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = connectGoogleSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
  }

  let accountEmail = parsed.data.accountEmail.trim();
  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${parsed.data.accessToken}` },
  });
  if (profileRes.ok) {
    const profile = (await profileRes.json()) as { email?: string };
    if (profile.email) accountEmail = profile.email;
  }

  const expiresAt = parsed.data.expiresInSec
    ? new Date(Date.now() + parsed.data.expiresInSec * 1000).toISOString()
    : new Date(Date.now() + 3600 * 1000).toISOString();

  const r = await upsertCalendarConnectionServer({
    organizationId: g.ctx.session.organizationId,
    ownerUid: g.ctx.session.uid,
    provider: "google",
    accountEmail,
    accessToken: parsed.data.accessToken,
    tokenExpiresAt: expiresAt,
  });
  if ("error" in r) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, item: r.connection });
}

export async function PATCH(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
  }
  const r = await updateCalendarConnectionSettingsServer({
    organizationId: g.ctx.session.organizationId,
    ownerUid: g.ctx.session.uid,
    ...parsed.data,
  });
  if ("error" in r) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, item: r.connection });
}

export async function DELETE(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const r = await disconnectCalendarConnectionServer({
    organizationId: g.ctx.session.organizationId,
    ownerUid: g.ctx.session.uid,
    id,
  });
  if ("error" in r) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
