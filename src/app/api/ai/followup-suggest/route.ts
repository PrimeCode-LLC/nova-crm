import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { aiErrorResponse } from "@/lib/ai/ai-route-errors";
import { buildLeadAiContext } from "@/lib/ai/context/lead-context";
import { loadLeadAiContextServer } from "@/lib/ai/load-lead-ai-context-server";
import { runAiStructuredFeature } from "@/lib/ai/run-feature";
import { canUseAiFeature, getOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import { buildRagInstructionBlock } from "@/lib/ai/prompt-defaults";
import { retrieveRagChunksServer } from "@/lib/ai/rag-retrieve";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { recordAudit } from "@/lib/firestore/audit";
import type { ChannelKey, Role } from "@/lib/types";

const CHANNEL_VALUES = [
  "cold_email",
  "linkedin_outbound",
  "linkedin_1to1",
  "personalized_email",
  "website_form",
  "upwork",
  "job_apply",
  "other",
] as const;

/** OpenAI structured output requires every object property in `required` (no .optional()). */
const suggestSchema = z.object({
  planSummary: z.string(),
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        offsetDays: z.number().int().min(0).max(90),
        priority: z.enum(["low", "medium", "high", "urgent"]),
        channel: z.enum(CHANNEL_VALUES),
        messageBody: z.string().min(1).max(8_000),
        description: z.string().max(500),
        rationale: z.string().max(500),
      }),
    )
    .min(1)
    .max(8),
});

function normalizeSuggestResult(result: z.infer<typeof suggestSchema>) {
  return {
    planSummary: result.planSummary,
    items: result.items.map((it) => ({
      ...it,
      description: it.description.trim() || undefined,
      rationale: it.rationale.trim() || undefined,
    })),
  };
}

const bodySchema = z.object({
  leadId: z.string().min(1),
  userPrompt: z.string().max(500).optional(),
  regenerateContext: z.string().max(800).optional(),
  followupPlans: z
    .array(
      z.object({
        id: z.string(),
        status: z.enum(["active", "paused", "superseded", "completed"]),
        planSummary: z.string(),
        pausedReason: z.string().optional(),
        pausedAt: z.string().optional(),
      }),
    )
    .optional(),
  demoContext: z
    .object({
      lead: z.record(z.string(), z.unknown()),
      account: z.record(z.string(), z.unknown()).optional(),
      contact: z.record(z.string(), z.unknown()).optional(),
      deal: z.record(z.string(), z.unknown()).optional(),
      notes: z.array(z.record(z.string(), z.unknown())).optional(),
      timeline: z.array(z.record(z.string(), z.unknown())).optional(),
      touchpoints: z.array(z.record(z.string(), z.unknown())).optional(),
      followups: z.array(z.record(z.string(), z.unknown())).optional(),
      tasks: z.array(z.record(z.string(), z.unknown())).optional(),
      emailThreads: z
        .array(
          z.object({
            subject: z.string(),
            messages: z.array(
              z.object({ from: z.string(), date: z.string(), snippet: z.string() }),
            ),
          }),
        )
        .optional(),
    })
    .optional(),
});

export async function POST(req: Request) {
  const g = await guardTenantApi();
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

  const orgId = g.ctx.session.organizationId;
  const uid = g.ctx.session.uid;
  const db = getAdminDb();

  const userSnap = await db?.collection(COLLECTIONS.users).doc(uid).get();
  const roleId = (userSnap?.data()?.roleId ?? "salesperson") as Role;

  const settings = await getOrganizationAiSettingsServer(orgId);
  if (!canUseAiFeature(settings, "followup_suggest", roleId)) {
    return NextResponse.json(
      { error: "AI follow-up suggestions are not enabled for your role." },
      { status: 403 },
    );
  }

  const loaded = await loadLeadAiContextServer({
    organizationId: orgId,
    leadId: parsed.data.leadId,
    demoContext: parsed.data.demoContext,
  });
  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  const context = buildLeadAiContext({
    ...loaded,
    followupPlans: parsed.data.followupPlans as import("@/lib/types").FollowupPlan[] | undefined,
    regenerateContext: parsed.data.regenerateContext,
  });
  const feat = settings.features.followup_suggest;
  const ragMode = feat.ragMode ?? "reference";
  const chunks = await retrieveRagChunksServer({
    organizationId: orgId,
    query: `${loaded.lead.stage} ${loaded.lead.channel} follow-up ${parsed.data.userPrompt ?? ""}`,
    libraryIds: feat.libraryIds,
    scope: {
      channel: loaded.lead.channel,
      profileId: loaded.lead.profileId,
      campaignId: loaded.lead.campaignId,
    },
    topK: 6,
  });
  const ragBlock = buildRagInstructionBlock(
    ragMode,
    chunks.map((c) => ({ title: c.title, content: c.content })),
  );

  const userPrompt = parsed.data.userPrompt?.trim() || "(none, use lead context only)";

  try {
    const result = await runAiStructuredFeature({
      organizationId: orgId,
      userId: uid,
      userDisplayName: g.ctx.session.name,
      roleId,
      feature: "followup_suggest",
      promptVars: {
        context,
        ragBlock: ragBlock || "(none)",
        userPrompt,
        regenerateBlock: parsed.data.regenerateContext?.trim() || "(none)",
      },
      schema: suggestSchema,
      leadId: parsed.data.leadId,
    });
    void recordAudit({
      organizationId: orgId,
      actorUid: uid,
      event: "feature.followup_suggest",
      meta: {
        leadId: parsed.data.leadId,
        itemCount: result.items.length,
      },
    });
    return NextResponse.json({
      ...normalizeSuggestResult(result),
      leadChannel: loaded.lead.channel as ChannelKey,
    });
  } catch (e) {
    return aiErrorResponse(e);
  }
}
