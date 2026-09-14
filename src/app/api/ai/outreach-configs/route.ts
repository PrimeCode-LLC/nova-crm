import { NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import {
  createOutreachConfig,
  listOutreachConfigs,
  resolveOutreachConfig,
  getZonePointers,
} from "@/lib/ai/outreach-config-server";
import { getOutreachConfigScorecard } from "@/lib/ai/eval/scorecard-server";
import { projectOutreachFunnel } from "@/lib/ai/eval/projection";
import type { AiFeatureKey } from "@/lib/ai/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const g = await guardAdminFeature("outreach_lab");
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const featureKey = (url.searchParams.get("featureKey") ?? "followup_suggest") as AiFeatureKey;
  const orgId = g.ctx.session.organizationId;

  // Seed default config on first lab open so the page is never a dead empty state.
  let configs = await listOutreachConfigs(orgId, featureKey);
  if (configs.length === 0) {
    await resolveOutreachConfig(orgId, featureKey, "default");
    configs = await listOutreachConfigs(orgId, featureKey);
  }

  const zonePointers = await getZonePointers(orgId, featureKey);

  const withScorecards = await Promise.all(
    configs.map(async (c) => ({
      ...c,
      scorecard: await getOutreachConfigScorecard(orgId, c.id),
      zones: (["lab", "canary", "default"] as const).filter(
        (z) => zonePointers[z] === c.id,
      ),
    })),
  );
  return NextResponse.json({
    configs: withScorecards,
    zonePointers,
    projection: projectOutreachFunnel({ targetDeals: 1 }),
  });
}

const createSchema = z.object({
  featureKey: z.string().default("followup_suggest"),
  label: z.string().min(1).max(200),
  systemPrompt: z.string().min(1),
  userPromptTemplate: z.string().min(1),
  parentConfigId: z.string().optional(),
  notes: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
});

export async function POST(req: Request) {
  const g = await guardAdminFeature("outreach_lab");
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const result = await createOutreachConfig({
    organizationId: g.ctx.session.organizationId,
    featureKey: parsed.data.featureKey as AiFeatureKey,
    label: parsed.data.label,
    systemPrompt: parsed.data.systemPrompt,
    userPromptTemplate: parsed.data.userPromptTemplate,
    parentConfigId: parsed.data.parentConfigId,
    notes: parsed.data.notes,
    provider: parsed.data.provider,
    model: parsed.data.model,
    createdBy: g.ctx.session.uid,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, id: result.id });
}
