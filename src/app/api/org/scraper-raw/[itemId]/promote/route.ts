import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { promoteRawItemToProspectServer } from "@/lib/scrapers/promote-server";
import { recordAudit } from "@/lib/documents/audit";

const bodySchema = z.object({
  /** Empty or omitted = open queue (anyone can claim). */
  assignToMe: z.boolean().optional(),
  ownerId: z.string().optional(),
  scraperId: z.string().optional(),
});

type RouteCtx = { params: Promise<{ itemId: string }> };

export async function POST(req: Request, ctx: RouteCtx) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const { itemId } = await ctx.params;

  let json: unknown = {};
  try {
    const text = await req.text();
    if (text.trim()) json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  let ownerId = parsed.data.ownerId?.trim() ?? "";
  if (parsed.data.assignToMe) ownerId = g.ctx.session.uid;

  const result = await promoteRawItemToProspectServer({
    organizationId: g.ctx.session.organizationId,
    itemId,
    userId: g.ctx.session.uid,
    ownerId,
    scraperId: parsed.data.scraperId,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  void recordAudit({
    organizationId: g.ctx.session.organizationId,
    actorUid: g.ctx.session.uid,
    event: "scraper.raw_promote",
    meta: { leadId: result.leadId, rawItemId: itemId },
  });

  return NextResponse.json(result);
}
