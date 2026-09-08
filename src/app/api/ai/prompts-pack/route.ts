import { NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import {
  importPromptsPackServer,
  previewPromptsPack,
} from "@/lib/ai/knowledge-pack-import-server";
import { recordAudit } from "@/lib/documents/audit";

const bodySchema = z.object({
  pack: z.unknown(),
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

  if (mode === "preview") {
    const preview = previewPromptsPack({ pack: parsed.data.pack });
    if (!preview.ok) {
      return NextResponse.json({ error: preview.error }, { status: 400 });
    }
    return NextResponse.json({ preview });
  }

  if (mode === "confirm") {
    const result = await importPromptsPackServer({ pack: parsed.data.pack });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    await recordAudit({
      organizationId: g.ctx.session.organizationId,
      actorUid: g.ctx.session.uid,
      event: "ai.settings_updated",
      meta: {
        type: "prompts_pack_import",
        written: result.written,
        skippedStale: result.skippedStale,
        scope: "platform",
      },
    });

    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "mode must be preview or confirm" }, { status: 400 });
}
