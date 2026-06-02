import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import { OPPORTUNITY_SOURCE_TYPES } from "@/lib/ai/opportunity-fit-types";
import { seedFitCheckCategoryLibraryServer } from "@/lib/ai/seed-fit-check-library-server";

const bodySchema = z.object({
  category: z.enum(OPPORTUNITY_SOURCE_TYPES),
  rescrape: z.boolean().optional(),
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

  const result = await seedFitCheckCategoryLibraryServer({
    organizationId: g.ctx.session.organizationId,
    userId: g.ctx.session.uid,
    category: parsed.data.category,
    rescrape: parsed.data.rescrape ?? true,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(result);
}

