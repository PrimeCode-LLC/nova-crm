import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { aiErrorResponse } from "@/lib/ai/ai-route-errors";
import { buildLeadAiContext } from "@/lib/ai/context/lead-context";
import {
  buildFollowupPersonalizationProfile,
  formatFollowupRoleGuidance,
} from "@/lib/ai/followup-personalization";
import {
  buildLeadSignalProfile,
  formatLeadSignalGuidance,
} from "@/lib/ai/lead-signal-profile";
import { loadLeadAiContextServer } from "@/lib/ai/load-lead-ai-context-server";
import { runAiStructuredFeature } from "@/lib/ai/run-feature";
import { canUseAiFeature, getOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import { retrieveOutreachKnowledgeServer } from "@/lib/ai/outreach-knowledge-server";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { recordAudit } from "@/lib/firestore/audit";
import { getScriptServer } from "@/lib/platform/script-library-server";
import { roleAtLeast } from "@/lib/platform/org-role";
import type { ChannelKey, Role, ScriptLibraryItem } from "@/lib/types";
import { stripTrailingEmailSignOff } from "@/lib/email/strip-trailing-email-signoff";
import { buildChannelMixHint } from "@/lib/followup-plans";

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
const suggestItemSchema = z.object({
  title: z.string().min(1).max(200),
  offsetDays: z.number().int().min(0).max(90),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  channel: z.enum(CHANNEL_VALUES),
  emailSubject: z.string().max(200),
  messageBody: z.string().min(1).max(8_000),
  description: z.string().max(500),
  rationale: z.string().max(500),
});

const suggestSchema = z.object({
  planSummary: z.string(),
  items: z.array(suggestItemSchema).min(1).max(8),
});

const singleStepSuggestSchema = z.object({
  planSummary: z.string(),
  items: z.array(suggestItemSchema).length(1),
});

function normalizeSuggestResult(result: z.infer<typeof suggestSchema>) {
  return {
    planSummary: result.planSummary,
    items: result.items.map((it) => ({
      ...it,
      messageBody: stripTrailingEmailSignOff(it.messageBody),
      emailSubject: it.emailSubject.trim() || undefined,
      description: it.description.trim() || undefined,
      rationale: it.rationale.trim() || undefined,
    })),
  };
}

const selectedTemplateSchema = z.object({
  id: z.string().min(1),
  title: z.string().max(200),
  category: z.string().max(40),
  primaryText: z.string().max(10_000),
  secondaryText: z.string().max(10_000).optional(),
});

const bodySchema = z.object({
  leadId: z.string().min(1),
  userPrompt: z.string().max(500).optional(),
  sequenceMode: z.enum(["full", "continue"]).optional(),
  /** How to assign channels across steps: lead | email | linkedin | multi_channel. */
  channelMix: z.enum(["lead", "email", "linkedin", "multi_channel"]).optional(),
  /** Optional Script library id - style guide only; omit to generate without a template. */
  scriptId: z.string().min(1).max(120).optional(),
  singleStep: z.boolean().optional(),
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
      /** Demo-only: client-resolved template when scriptId is not in Firestore. */
      selectedTemplate: selectedTemplateSchema.optional(),
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
    emailThreads: parsed.data.emailThreads,
  });
  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }
  if (loaded.lead.doNotContact) {
    return NextResponse.json(
      { error: "This prospect is marked do not contact. Remove that restriction before generating outreach." },
      { status: 409 },
    );
  }

  let selectedTemplate: Pick<
    ScriptLibraryItem,
    "id" | "title" | "category" | "primaryText" | "secondaryText"
  > | null = null;
  const scriptId = parsed.data.scriptId?.trim();
  if (scriptId) {
    const script = await getScriptServer(scriptId);
    const canUse =
      script &&
      script.organizationId === orgId &&
      (roleAtLeast(g.ctx.role, "admin") || script.ownerUid === uid);
    if (canUse && script) {
      selectedTemplate = {
        id: script.id,
        title: script.title,
        category: script.category,
        primaryText: script.primaryText,
        secondaryText: script.secondaryText,
      };
    } else if (parsed.data.demoContext?.selectedTemplate?.id === scriptId) {
      const t = parsed.data.demoContext.selectedTemplate;
      selectedTemplate = {
        id: t.id,
        title: t.title,
        category: t.category as ScriptLibraryItem["category"],
        primaryText: t.primaryText,
        secondaryText: t.secondaryText,
      };
    }
  }

  const context = buildLeadAiContext({
    ...loaded,
    followupPlans: parsed.data.followupPlans as import("@/lib/types").FollowupPlan[] | undefined,
    regenerateContext: parsed.data.regenerateContext,
    selectedTemplate,
  });
  const contactTitle = loaded.contact?.title?.trim() || loaded.lead.contactTitle;
  const personalizationProfile = buildFollowupPersonalizationProfile({
    title: contactTitle,
    seniority: loaded.contact?.seniority,
  });
  const signalProfile = buildLeadSignalProfile({
    lead: loaded.lead,
    account: loaded.account,
    contact: loaded.contact,
  });
  const roleGuidance = [
    formatFollowupRoleGuidance(personalizationProfile),
    formatLeadSignalGuidance(signalProfile),
    `Lead stage: ${loaded.lead.stage || "unknown"}`,
    `Temperature: ${loaded.lead.temperature || "unknown"}`,
    `Channel: ${loaded.lead.channel || "unknown"}`,
    loaded.lead.personalizationNote?.suggestedAngle
      ? `Suggested angle: ${loaded.lead.personalizationNote.suggestedAngle}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
  const feat = settings.features.followup_suggest;
  const ragMode = feat.ragMode ?? "reference";
  const ragQuery = [
    loaded.lead.stage,
    loaded.lead.channel,
    personalizationProfile.roleFamily,
    contactTitle,
    loaded.contact?.seniority,
    loaded.account?.industry || loaded.lead.companyIndustry,
    loaded.account?.businessDescription,
    loaded.lead.primaryOpportunityLabel,
    loaded.lead.personalizationNote?.suggestedAngle,
    loaded.strategy?.name,
    loaded.strategy?.objective,
    loaded.persona?.name,
    loaded.persona?.recommendedAngle,
    "follow-up",
    parsed.data.userPrompt,
  ]
    .filter(Boolean)
    .join(" ");
  const { ragBlock } = await retrieveOutreachKnowledgeServer({
    organizationId: orgId,
    query: ragQuery,
    configuredLibraryIds: feat.libraryIds,
    ragMode,
    scope: {
      channel: loaded.lead.channel,
      profileId: loaded.lead.profileId,
      campaignId: loaded.lead.campaignId,
    },
  });

  const userPrompt = parsed.data.userPrompt?.trim() || "(none, use lead context only)";
  const sequenceMode = parsed.data.sequenceMode ?? "full";
  const channelMix = parsed.data.channelMix ?? "lead";
  const sequenceModeHint = parsed.data.singleStep
    ? "Regenerate exactly ONE replacement follow-up step. Preserve its purpose and position in the cadence, but rewrite the title, subject, notes, and message using current lead context. Return exactly one item."
    : sequenceMode === "continue"
      ? "Intro/first outreach already sent. Do NOT draft a cold opener. Number steps as remaining follow-ups (e.g. Email 2+ / LinkedIn bump)."
      : "Full personalized outreach from first touch through last touch.";
  const channelMixHint = buildChannelMixHint(channelMix);
  // Also fold into roleGuidance so customized org prompts without {{channelMixHint}} still obey the mix.
  const roleGuidanceWithMix = `${roleGuidance}\n${channelMixHint}`;
  const templateHint = selectedTemplate
    ? `Rep selected style template "${selectedTemplate.title}" (${selectedTemplate.category}). Match its tone, length, structure, and CTA style - rewrite for this lead; do not copy verbatim. Full text is in context.selectedTemplate.`
    : "(none - no style template selected; generate from lead context and instructions only)";

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
        sequenceMode,
        sequenceModeHint,
        channelMix,
        channelMixHint,
        templateHint,
        regenerateBlock: parsed.data.regenerateContext?.trim() || "(none)",
        roleGuidance: roleGuidanceWithMix,
      },
      schema: parsed.data.singleStep ? singleStepSuggestSchema : suggestSchema,
      leadId: parsed.data.leadId,
    });
    void recordAudit({
      organizationId: orgId,
      actorUid: uid,
      event: "feature.followup_suggest",
      meta: {
        leadId: parsed.data.leadId,
        itemCount: result.items.length,
        sequenceMode,
        channelMix,
        singleStep: parsed.data.singleStep === true,
        scriptId: selectedTemplate?.id ?? null,
      },
    });
    return NextResponse.json({
      ...normalizeSuggestResult(result),
      leadChannel: loaded.lead.channel as ChannelKey,
      sequenceMode,
      channelMix,
    });
  } catch (e) {
    return aiErrorResponse(e, {
      organizationId: g.ctx.session.organizationId,
      actorUid: g.ctx.session.uid,
      actorEmail: g.ctx.session.email,
      location: "src/app/api/ai/followup-suggest/route.ts",
      functionName: "handler",
      route: "/api/ai/followup-suggest",
    });
  }
}
