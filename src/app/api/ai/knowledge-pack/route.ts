import { NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import {
  importKnowledgePackServer,
  previewKnowledgePackWithExisting,
} from "@/lib/ai/knowledge-pack-import-server";
import { recordAudit } from "@/lib/documents/audit";

const bodySchema = z.object({
  pack: z.unknown(),
  indexDocuments: z.boolean().optional(),
});

export async function POST(req: Request) {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "preview";

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

  const orgId = g.ctx.session.organizationId;

  if (mode === "preview") {
    const preview = await previewKnowledgePackWithExisting({
      pack: parsed.data.pack,
      targetOrganizationId: orgId,
    });
    if (!preview.ok) {
      return NextResponse.json({ error: preview.error }, { status: 400 });
    }
    return NextResponse.json({ preview });
  }

  if (mode === "confirm") {
    const result = await importKnowledgePackServer({
      pack: parsed.data.pack,
      targetOrganizationId: orgId,
      userId: g.ctx.session.uid,
      indexDocuments: parsed.data.indexDocuments,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    await recordAudit({
      organizationId: orgId,
      actorUid: g.ctx.session.uid,
      event: "ai.settings_updated",
      meta: {
        type: "knowledge_pack_import",
        imported: result.imported,
        indexed: { ok: result.indexed.ok, failed: result.indexed.failed },
      },
    });

    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "mode must be preview or confirm" }, { status: 400 });
}
