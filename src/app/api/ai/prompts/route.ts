import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getAiPromptServer, upsertAiPromptServer } from "@/lib/ai/ai-settings-server";
import type { AiFeatureKey } from "@/lib/ai/types";
import { recordAudit } from "@/lib/firestore/audit";

const FEATURE_KEYS = ["dashboard_brief", "lead_analyze", "email_reply", "rag_index"] as const;

export async function GET(req: Request) {
  const g = await guardTenantApi({ minRole: "admin" });
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
  const g = await guardTenantApi({ minRole: "admin" });
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
