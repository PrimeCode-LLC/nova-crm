import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import { seedFitCheckLibraryServer } from "@/lib/ai/seed-fit-check-library-server";
import { recordAudit } from "@/lib/firestore/audit";

const bodySchema = z
  .object({
    rescrape: z.boolean().optional(),
  })
  .optional();

export async function POST(req: Request) {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  let rescrape = true;
  try {
    const json = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json);
    if (parsed.success && parsed.data?.rescrape === false) rescrape = false;
  } catch {
    /* default rescrape */
  }

  const result = await seedFitCheckLibraryServer({
    organizationId: g.ctx.session.organizationId,
    userId: g.ctx.session.uid,
    rescrape,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  await recordAudit({
    organizationId: g.ctx.session.organizationId,
    actorUid: g.ctx.session.uid,
    event: "ai.library_indexed",
    meta: {
      globalLibraryId: result.globalLibraryId,
      documentsCreated: result.documentsCreated,
      pagesCrawled: result.pagesCrawled,
      indexErrors: result.indexErrors.length,
    },
  });

  return NextResponse.json(result);
}
