import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import { getAiPromptServer, upsertAiPromptServer } from "@/lib/ai/ai-settings-server";
import { REQUIRED_PROMPT_VARS } from "@/lib/ai/prompt-defaults";
import type { AiFeatureKey } from "@/lib/ai/types";
import { recordAudit } from "@/lib/firestore/audit";

const FEATURE_KEYS = [
  "dashboard_brief",
  "lead_analyze",
  "intent_suggest",
  "followup_suggest",
  "email_reply",
  "prospect_draft_extract",
  "opportunity_fit",
  "opportunity_fit_discuss",
  "intent_radar_evaluate",
  "content_capture_normalize",
  "content_plan_suggest",
  "content_draft_generate",
  "content_graphics_brief",
  "rag_index",
] as const;

export async function GET(req: Request) {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const feature = url.searchParams.get("feature") as AiFeatureKey | null;
  const orgId = g.ctx.session.organizationId;

  if (feature && FEATURE_KEYS.includes(feature as (typeof FEATURE_KEYS)[number])) {
    const prompt = await getAiPromptServer(orgId, feature);
    return NextResponse.json({ prompt });
  }

  const prompts = await Promise.all(
    FEATURE_KEYS.map((f) => getAiPromptServer(orgId, f)),
  );
  return NextResponse.json({ prompts });
}

const patchSchema = z.object({
  featureKey: z.enum(FEATURE_KEYS),
  systemPrompt: z.string().min(1).max(20_000),
  userPromptTemplate: z.string().min(1).max(20_000),
});

export async function PATCH(req: Request) {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

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

  // Content prompts carry their platform rules through placeholders. Saving a
  // template without them would silently strip that context at generation time.
  const missing = (REQUIRED_PROMPT_VARS[parsed.data.featureKey] ?? []).filter(
    (name) => !parsed.data.userPromptTemplate.includes(`{{${name}}}`),
  );
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `This prompt must keep ${missing
          .map((n) => `{{${n}}}`)
          .join(", ")} in the user template, otherwise platform rules are dropped.`,
      },
      { status: 400 },
    );
  }

  const result = await upsertAiPromptServer(g.ctx.session.organizationId, parsed.data);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  await recordAudit({
    organizationId: g.ctx.session.organizationId,
    actorUid: g.ctx.session.uid,
    event: "ai.settings_updated",
    meta: { feature: parsed.data.featureKey, type: "prompt" },
  });

  const prompt = await getAiPromptServer(g.ctx.session.organizationId, parsed.data.featureKey);
  return NextResponse.json({ prompt });
}
