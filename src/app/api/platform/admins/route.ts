import { NextResponse } from "next/server";
import { z } from "zod";
import { guardPlatformApi } from "@/lib/platform/platform-api-guard";
import {
  grantPlatformAdminServer,
  listPlatformAdminsServer,
  revokePlatformAdminServer,
  updatePlatformAdminRoleServer,
} from "@/lib/platform/platform-admins-server";
import { recordPlatformAudit } from "@/lib/platform/platform-audit-server";

const postSchema = z.object({
  email: z.string().email(),
  role: z.enum(["owner", "admin"]).default("admin"),
});

const patchSchema = z.object({
  uid: z.string().min(1),
  role: z.enum(["owner", "admin"]),
});

export async function GET() {
  const g = await guardPlatformApi();
  if (!g.ok) return g.response;
  const admins = await listPlatformAdminsServer();
  return NextResponse.json({ admins });
}

export async function POST(req: Request) {
  const g = await guardPlatformApi();
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const result = await grantPlatformAdminServer(
    parsed.data.email,
    parsed.data.role,
    g.ctx.session.uid,
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await recordPlatformAudit({
    event: "admin.granted",
    actorUid: g.ctx.session.uid,
    actorEmail: g.ctx.session.email,
    summary: `Granted platform ${parsed.data.role} to ${parsed.data.email}`,
    metadata: { email: parsed.data.email, role: parsed.data.role },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function PATCH(req: Request) {
  const g = await guardPlatformApi();
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const result = await updatePlatformAdminRoleServer(
    parsed.data.uid,
    parsed.data.role,
    g.ctx.session.uid,
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await recordPlatformAudit({
    event: "admin.role_changed",
    actorUid: g.ctx.session.uid,
    actorEmail: g.ctx.session.email,
    targetUid: parsed.data.uid,
    summary: `Changed platform admin role to ${parsed.data.role}`,
    metadata: { role: parsed.data.role },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const g = await guardPlatformApi();
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const targetUid = url.searchParams.get("uid")?.trim();
  if (!targetUid) {
    return NextResponse.json({ error: "uid query parameter required" }, { status: 400 });
  }

  const result = await revokePlatformAdminServer(g.ctx.session.uid, targetUid);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await recordPlatformAudit({
    event: "admin.revoked",
    actorUid: g.ctx.session.uid,
    actorEmail: g.ctx.session.email,
    targetUid,
    summary: `Revoked platform admin access for ${targetUid}`,
  });

  return NextResponse.json({ ok: true });
}
