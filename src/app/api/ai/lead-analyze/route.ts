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
import type { Role } from "@/lib/types";

const analysisSchema = z.object({
  summary: z.string(),
  wins: z.array(z.string()),
  issues: z.array(z.string()),
  improvements: z.array(z.string()),
  riskLevel: z.enum(["low", "medium", "high"]),
  nextActions: z.array(z.string()),
});

const bodySchema = z.object({
  leadId: z.string().min(1),
  emailThreads: z
    .array(
      z.object({
        subject: z.string().max(500),
        messages: z
          .array(
            z.object({
              from: z.string().max(500),
              date: z.string().max(100),
              snippet: z.string().max(2_000),
            }),
          )
          .max(20),
      }),
    )
    .max(20)
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
      campaign: z.record(z.string(), z.unknown()).optional(),
      profile: z.record(z.string(), z.unknown()).optional(),
      strategy: z.record(z.string(), z.unknown()).optional(),
      persona: z.record(z.string(), z.unknown()).optional(),
      strategyAssignment: z.record(z.string(), z.unknown()).optional(),
      caseStudy: z.record(z.string(), z.unknown()).optional(),
      labels: z.array(z.record(z.string(), z.unknown())).optional(),
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
  if (!canUseAiFeature(settings, "lead_analyze", roleId)) {
    return NextResponse.json({ error: "Lead analysis is not enabled for your role." }, { status: 403 });
  }

  const loaded = await loadLeadAiContextServer({
    organizationId: orgId,
    leadId: parsed.data.leadId,
    demoContext: parsed.data.demoContext,
    emailThreads: parsed.data.emailThreads,
  });
  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  const context = buildLeadAiContext(loaded);
  const feat = settings.features.lead_analyze;
  const ragMode = feat.ragMode ?? "reference";
  const chunks = await retrieveRagChunksServer({
    organizationId: orgId,
    query: [
      loaded.lead.stage,
      loaded.lead.channel,
      loaded.lead.temperature,
      loaded.lead.priority,
      loaded.lead.painPoints,
      loaded.lead.triggerEvent,
      loaded.lead.businessFocus,
      loaded.lead.hiringSignals,
      loaded.lead.recentNews,
      loaded.lead.primaryOpportunityLabel,
      loaded.lead.personalizationNote?.relevantService,
      loaded.lead.personalizationNote?.suggestedAngle,
      loaded.account?.industry || loaded.lead.companyIndustry,
      loaded.account?.businessDescription,
      loaded.contact?.title || loaded.lead.contactTitle,
      loaded.contact?.seniority,
      loaded.strategy?.name,
      loaded.strategy?.objective,
      loaded.persona?.name,
      loaded.persona?.recommendedAngle,
      "lead analysis qualification risk next action",
    ]
      .filter(Boolean)
      .join(" "),
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

  try {
    const result = await runAiStructuredFeature({
      organizationId: orgId,
      userId: uid,
      userDisplayName: g.ctx.session.name,
      roleId,
      feature: "lead_analyze",
      promptVars: {
        context,
        ragBlock: ragBlock || "(none)",
      },
      schema: analysisSchema,
      leadId: parsed.data.leadId,
    });
    void recordAudit({
      organizationId: orgId,
      actorUid: uid,
      event: "feature.lead_analyze",
      meta: { leadId: parsed.data.leadId },
    });
    return NextResponse.json(result);
  } catch (e) {
    return aiErrorResponse(e, {
      organizationId: g.ctx.session.organizationId,
      actorUid: g.ctx.session.uid,
      actorEmail: g.ctx.session.email,
      location: "src/app/api/ai/lead-analyze/route.ts",
      functionName: "handler",
      route: "/api/ai/lead-analyze",
    });
  }
}
