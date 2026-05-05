import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi, roleAtLeast } from "@/lib/platform/tenant-api-guard";
import {
  createScriptServer,
  deleteScriptServer,
  getScriptServer,
  listScriptsServer,
  updateScriptServer,
} from "@/lib/platform/script-library-server";

const categoryEnum = z.enum([
  "pitch",
  "rebuttal",
  "email_template",
  "call_script",
  "meeting_agenda",
  "followup_template",
  "other",
]);

const createSchema = z.object({
  title: z.string().min(1).max(120),
  category: categoryEnum,
  primaryText: z.string().min(1).max(10000),
  secondaryText: z.string().max(10000).optional().default(""),
  tags: z.array(z.string().min(1).max(40)).max(15).default([]),
});

const patchSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120).optional(),
  category: categoryEnum.optional(),
  primaryText: z.string().min(1).max(10000).optional(),
  secondaryText: z.string().max(10000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(15).optional(),
});

export async function GET() {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const items = await listScriptsServer({
    organizationId: g.ctx.session.organizationId,
    actorUid: g.ctx.session.uid,
    actorRole: g.ctx.role,
  });
  return NextResponse.json({
    items,
    canViewAll: roleAtLeast(g.ctx.role, "admin"),
    role: g.ctx.role,
  });
}

export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const r = await createScriptServer({
    organizationId: g.ctx.session.organizationId,
    ownerUid: g.ctx.session.uid,
    ownerName: g.ctx.session.name,
    title: parsed.data.title,
    category: parsed.data.category,
    primaryText: parsed.data.primaryText,
    secondaryText: parsed.data.secondaryText,
    tags: parsed.data.tags.map((t) => t.trim()).filter(Boolean),
  });
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ item: r.script }, { status: 201 });
}

export async function PATCH(req: Request) {
  const g = await guardTenantApi();
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
  const existing = await getScriptServer(parsed.data.id);
  if (!existing || existing.organizationId !== g.ctx.session.organizationId) {
    return NextResponse.json({ error: "Script not found" }, { status: 404 });
  }
  const isAdmin = roleAtLeast(g.ctx.role, "admin");
  if (!isAdmin && existing.ownerUid !== g.ctx.session.uid) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const r = await updateScriptServer(parsed.data);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ item: r.script });
}

export async function DELETE(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const existing = await getScriptServer(id);
  if (!existing || existing.organizationId !== g.ctx.session.organizationId) {
    return NextResponse.json({ error: "Script not found" }, { status: 404 });
  }
  const isAdmin = roleAtLeast(g.ctx.role, "admin");
  if (!isAdmin && existing.ownerUid !== g.ctx.session.uid) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const r = await deleteScriptServer(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
