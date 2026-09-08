import { NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import {
  listContentBrandsServer,
  upsertContentBrandServer,
} from "@/lib/content-calendar/content-brands-server";

export async function GET() {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  const brands = await listContentBrandsServer(g.ctx.session.organizationId);
  return NextResponse.json({ brands });
}

const bodySchema = z.object({
  brandId: z.string().min(1).optional(),
  name: z.string().min(1).max(200),
  kind: z.enum(["company", "founder", "product", "employee", "community"]),
  voiceRules: z.string().max(20_000).optional(),
  positioning: z.string().max(20_000).optional(),
  knowledgeLibraryIds: z.array(z.string()).default([]),
});

export async function POST(req: Request) {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await upsertContentBrandServer({
    organizationId: g.ctx.session.organizationId,
    userId: g.ctx.session.uid,
    ...parsed.data,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ brand: result.brand });
}
