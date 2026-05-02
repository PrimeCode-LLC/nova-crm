import { NextResponse } from "next/server";
import { z } from "zod";
import { guardPlatformApi } from "@/lib/platform/platform-api-guard";
import {
  grantPlatformAdminServer,
  listPlatformAdminsServer,
  revokePlatformAdminServer,
} from "@/lib/platform/platform-admins-server";

const postSchema = z.object({
  email: z.string().email(),
  role: z.enum(["owner", "admin"]).default("admin"),
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
    g.ctx.adminAuth,
    parsed.data.email,
    parsed.data.role,
    g.ctx.session.uid,
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
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
  return NextResponse.json({ ok: true });
}
