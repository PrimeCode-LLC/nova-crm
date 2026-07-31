import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { aiErrorResponse } from "@/lib/ai/ai-route-errors";
import { runAiStructuredFeature, runAiTextFeature } from "@/lib/ai/run-feature";
import { canUseAiFeature, getOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import { retrieveOutreachKnowledgeServer } from "@/lib/ai/outreach-knowledge-server";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { splitComposerReplyBody } from "@/lib/email/compose-draft-text";
import {
  buildLeadMailThreadForReply,
  buildManualComposeReplyGuidance,
  leadSnapshotForReply,
  loadLeadForReplyContext,
} from "@/lib/email/email-reply-context-server";
import { stripTrailingEmailSignOff } from "@/lib/email/strip-trailing-email-signoff";
import type { Role } from "@/lib/types";

const bodySchema = z.object({
  /** reply = generate; improve = polish draft; suggest = improve if draft exists else generate */
  mode: z.enum(["reply", "improve", "review", "suggest"]).default("reply"),
  thread: z.string().max(50_000).optional(),
  draft: z.string().max(50_000).optional(),
  /** Full composer body (signature + quote). Used by suggest to detect user draft. */
  composeBody: z.string().max(50_000).optional(),
  subject: z.string().max(500).optional(),
  leadContext: z.string().max(20_000).optional(),
  leadId: z.string().optional(),
  channel: z.string().optional(),
  profileId: z.string().optional(),
  campaignId: z.string().optional(),
  tone: z.enum(["professional", "friendly", "concise"]).default("professional"),
  goal: z.string().max(200).default("follow up"),
});

const reviewSchema = z.object({
  summary: z.string().min(1).max(600),
  verdict: z.string().min(1).max(120),
  overallScore: z.number().int().min(0).max(100),
  dimensions: z.object({
    personalization: z.number().int().min(0).max(100),
    threadFit: z.number().int().min(0).max(100),
    clarity: z.number().int().min(0).max(100),
    cta: z.number().int().min(0).max(100),
    tone: z.number().int().min(0).max(100),
  }),
  wins: z.array(z.string().min(1).max(240)).max(4),
  issues: z.array(z.string().min(1).max(240)).max(4),
  improvements: z.array(z.string().min(1).max(240)).max(5),
  improvedBody: z.string().min(1).max(12_000),
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
  const userSnap = await getAdminDb()?.collection(COLLECTIONS.users).doc(uid).get();
  const roleId = (userSnap?.data()?.roleId ?? "salesperson") as Role;

  const settings = await getOrganizationAiSettingsServer(orgId);
  if (!canUseAiFeature(settings, "email_reply", roleId)) {
    return NextResponse.json({ error: "AI email reply is not enabled for your role." }, { status: 403 });
  }

  const composeSource =
    parsed.data.composeBody?.trim() || parsed.data.draft?.trim() || "";
  const { userDraft } = splitComposerReplyBody(composeSource);
  // Prefer extracted user text so signature + quoted trail never pollute the draft.
  const explicitDraft = userDraft;

  let effectiveMode: "reply" | "improve" | "review" =
    parsed.data.mode === "review"
      ? "review"
      : parsed.data.mode === "improve"
        ? "improve"
        : parsed.data.mode === "suggest"
          ? explicitDraft
            ? "improve"
            : "reply"
          : "reply";

  // Enrich from lead mail + prospect details when a lead is linked (same sources as Reply intelligence).
  let threadText = parsed.data.thread?.trim() ?? "";
  let leadContextText = parsed.data.leadContext?.trim() ?? "";
  let replyGuidance =
    "(none - rep is composing manually; infer the right next step from the thread)";
  let channel = parsed.data.channel;
  let profileId = parsed.data.profileId;
  let campaignId = parsed.data.campaignId;

  if (parsed.data.leadId) {
    const lead = await loadLeadForReplyContext({
      organizationId: orgId,
      leadId: parsed.data.leadId,
    });
    if (lead) {
      leadContextText = leadSnapshotForReply(lead);
      replyGuidance = buildManualComposeReplyGuidance(lead);
      channel = channel || lead.channel;
      profileId = profileId || lead.profileId;
      campaignId = campaignId || lead.campaignId;

      const threadCtx = await buildLeadMailThreadForReply({
        organizationId: orgId,
        leadId: lead.id,
      });
      if (threadCtx.thread && threadCtx.thread !== "(no prior thread stored)") {
        threadText = threadCtx.thread.slice(0, 20_000);
      }
    }
  }

  if (effectiveMode === "reply" && !threadText) {
    // Fall back to compose body as thin thread context when no lead mail exists.
    const fallback = parsed.data.composeBody?.trim() || parsed.data.thread?.trim() || "";
    if (!fallback) {
      return NextResponse.json(
        { error: "thread is required for reply mode (link a lead or paste conversation context)" },
        { status: 400 },
      );
    }
    threadText = fallback.slice(0, 20_000);
  }
  if (effectiveMode === "improve" && !explicitDraft) {
    return NextResponse.json({ error: "draft is required for improve mode" }, { status: 400 });
  }
  if (effectiveMode === "review" && !explicitDraft) {
    return NextResponse.json({ error: "draft is required for review mode" }, { status: 400 });
  }

  const feat = settings.features.email_reply;
  const ragQuery =
    effectiveMode === "reply" ? threadText.slice(0, 500) : explicitDraft.slice(0, 500);
  const { ragBlock } = await retrieveOutreachKnowledgeServer({
    organizationId: orgId,
    query: ragQuery,
    configuredLibraryIds: feat.libraryIds,
    ragMode: feat.ragMode ?? "reference",
    scope: {
      channel,
      profileId,
      campaignId,
    },
  });

  try {
    const isImprove = effectiveMode === "improve";
    const isReview = effectiveMode === "review";
    const draftText = explicitDraft;
    const subjectLine = parsed.data.subject?.trim() || "(no subject)";

    const userPromptOverride = isImprove
      ? `Improve this email draft for higher reply and meeting rates. Preserve intent and factual claims. Do not invent facts.

Rules while improving:
- Keep it brief; short paragraphs; one idea; one clear CTA.
- Make the first line about the recipient or their situation when the draft allows.
- Prefer a micro-commit or specific 15-min ask over a vague "let me know".
- Remove sales clichés ("just following up", "circling back", "touching base", "I know you're busy").
- Match tone: ${parsed.data.tone}. Goal: ${parsed.data.goal}.
- Use the full thread and prospect details below as grounding; do not invent facts not present there.

Subject: ${subjectLine}

Draft to improve:
${draftText}
${threadText ? `\nThread context (for reference only):\n${threadText}` : ""}

Lead context (if any):
${leadContextText || "(no lead linked)"}

Reply guidance:
${replyGuidance}

${ragBlock || "(none)"}

Output only the improved email body text (no closing line like "Best,", no signature).`
      : isReview
        ? `Review this outbound email draft against the full email thread, lead context, and outreach guidance. Be specific, practical, and honest. Preserve facts and do not invent details.

Score each dimension from 0 to 100:
- personalization: how tailored it feels to this recipient
- threadFit: how well it matches the live conversation and lead context
- clarity: how easy the message is to understand quickly
- cta: how clear and easy the next step is
- tone: how credible, natural, and professional the wording feels

Review rules:
- Reward relevance, specificity, and an easy next step.
- Penalize generic openers, vague CTAs, needless length, and unsupported claims.
- Keep wins, issues, and improvements concrete and short.
- improvedBody must be a stronger rewrite of the same message, not a different strategy.
- Do not include a sign-off, signature, subject line, markdown, or explanation outside the structured response.
- Match tone: ${parsed.data.tone}. Goal: ${parsed.data.goal}.

Subject: ${subjectLine}

Draft to review:
${draftText}
${threadText ? `\nThread context:\n${threadText}` : "\nThread context:\n(no prior thread available)"}

Lead context (if any):
${leadContextText || "(no lead linked)"}

Reply guidance:
${replyGuidance}

Reference knowledge:
${ragBlock || "(none)"}
`
      : undefined;

    if (isReview) {
      const review = await runAiStructuredFeature({
        organizationId: orgId,
        userId: uid,
        userDisplayName: g.ctx.session.name,
        roleId,
        feature: "email_reply",
        promptVars: {
          today: new Date().toISOString().slice(0, 10),
          tone: parsed.data.tone,
          goal: parsed.data.goal,
          replyGuidance,
          thread: threadText || draftText,
          leadContext: leadContextText || "(no lead linked)",
          ragBlock: ragBlock || "(none)",
        },
        schema: reviewSchema,
        userPromptOverride,
        leadId: parsed.data.leadId,
      });

      return NextResponse.json({
        review: {
          ...review,
          improvedBody: stripTrailingEmailSignOff(review.improvedBody),
        },
        mode: effectiveMode,
      });
    }

    const body = await runAiTextFeature({
      organizationId: orgId,
      userId: uid,
      userDisplayName: g.ctx.session.name,
      roleId,
      feature: "email_reply",
      promptVars: {
        today: new Date().toISOString().slice(0, 10),
        tone: parsed.data.tone,
        goal: parsed.data.goal,
        replyGuidance,
        thread: threadText || draftText,
        leadContext: leadContextText || "(no lead linked)",
        ragBlock: ragBlock || "(none)",
      },
      userPromptOverride,
      leadId: parsed.data.leadId,
    });
    return NextResponse.json({
      body: stripTrailingEmailSignOff(body),
      mode: effectiveMode,
    });
  } catch (e) {
    return aiErrorResponse(e, {
      organizationId: g.ctx.session.organizationId,
      actorUid: g.ctx.session.uid,
      actorEmail: g.ctx.session.email,
      location: "src/app/api/ai/email-reply/route.ts",
      functionName: "handler",
      route: "/api/ai/email-reply",
    });
  }
}
