import { NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import {
  deleteContentBrandServer,
  upsertContentBrandServer,
} from "@/lib/content-calendar/content-brands-server";

type Ctx = { params: Promise<{ brandId: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(["company", "founder", "product", "employee", "community"]),
  voiceRules: z.string().max(20_000).optional(),
  positioning: z.string().max(20_000).optional(),
  knowledgeLibraryIds: z.array(z.string()).default([]),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  const { brandId } = await ctx.params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await upsertContentBrandServer({
    organizationId: g.ctx.session.organizationId,
    userId: g.ctx.session.uid,
    brandId,
    ...parsed.data,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ brand: result.brand });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  const { brandId } = await ctx.params;
  const result = await deleteContentBrandServer({
    organizationId: g.ctx.session.organizationId,
    brandId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
