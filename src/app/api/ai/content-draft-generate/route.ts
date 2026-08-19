import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { aiErrorResponse } from "@/lib/ai/ai-route-errors";
import { runAiStructuredFeature } from "@/lib/ai/run-feature";
import { canUseAiFeature, getOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import {
  formatBrandContextForPrompt,
  getContentBrandServer,
  retrieveContentKnowledgeServer,
} from "@/lib/ai/content-knowledge-server";
import { getContentStrategyPack } from "@/lib/content-calendar/strategy-packs";
import {
  clampPostBody,
  scrubAiTellPunctuation,
  scrubPostBody,
} from "@/lib/content-calendar/schedule";
import {
  coerceFormatForPlatform,
  contentBodyCharTarget,
  formatPlatformPlaybookForPrompt,
  formatUsesSegments,
  getContentPlatformPlaybook,
} from "@/lib/content-calendar/platform-playbooks";
import { lintContentVariant } from "@/lib/content-calendar/post-lint";
import {
  CONTENT_PLATFORM_LABELS,
  contentVariantCharLimit,
  type ContentFormat,
} from "@/lib/content-calendar/types";
import type { Role } from "@/lib/types";

const PLATFORMS = ["linkedin", "x", "instagram", "reddit"] as const;
// Keep in sync with content-plan-suggest + ContentPillarKey / ContentCtaType.
const PILLARS = [
  "proof_case_study",
  "operator_lesson",
  "opinion_take",
  "soft_cta",
  "personal_journey",
  "product_education",
  "culture",
] as const;
const CTAS = [
  "book_fit_check",
  "reply_with_niche",
  "soft_dm",
  "share_lesson",
  "book_demo",
  "start_trial",
  "none",
] as const;
const FORMATS = [
  "text_post",
  "graphic_post",
  "thread",
  "carousel",
  "short_video",
  "long_form",
] as const;

const bodySchema = z.object({
  brandId: z.string().min(1),
  platform: z.enum(PLATFORMS),
  pillarKey: z.enum(PILLARS),
  title: z.string().min(1).max(200),
  angle: z.string().min(1).max(800),
  proofHint: z.string().max(500).optional(),
  ctaType: z.enum(CTAS),
  format: z.enum(FORMATS).optional(),
  audienceHint: z.string().max(300).optional(),
  /** Approved post being adapted, so a repurpose keeps the original argument. */
  sourcePlatform: z.enum(PLATFORMS).optional(),
  sourceBody: z.string().max(12_000).optional(),
});

// Structured output requires every property to be present, so optional-looking
// fields are declared required and returned as "" / [] when unused.
const draftSchema = z.object({
  hook: z.string().max(300),
  body: z.string().min(1).max(25_000),
  hashtags: z.array(z.string().max(80)).max(12),
  firstComment: z.string().max(600),
  segments: z.array(z.string().max(1_500)).max(12),
  altText: z.string().max(400),
  postTitle: z.string().max(300),
  citations: z
    .array(
      z.object({
        title: z.string().max(200),
        excerpt: z.string().max(500),
      }),
    )
    .max(8),
});

/** Bare, deduped tags capped to what the platform actually honors. */
function normalizeHashtags(raw: string[], max: number): string[] {
  if (max <= 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const tag = entry.replace(/[^\p{L}\p{N}_]/gu, "");
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

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
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const userSnap = await db.collection(COLLECTIONS.users).doc(uid).get();
  const roleId = (userSnap.data()?.roleId ?? "salesperson") as Role;

  const settings = await getOrganizationAiSettingsServer(orgId);
  if (!canUseAiFeature(settings, "content_draft_generate", roleId)) {
    return NextResponse.json(
      { error: "Content draft AI is not enabled for your role." },
      { status: 403 },
    );
  }

  const brand = await getContentBrandServer(orgId, parsed.data.brandId);
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const pack = getContentStrategyPack(brand.strategyPackId);
  const featureCfg = settings.features.content_draft_generate;
  const ragMode = featureCfg?.ragMode ?? "reference";

  const platform = parsed.data.platform;
  const playbook = getContentPlatformPlaybook(platform);
  // A plan can ask for a format the platform does not support (an X carousel).
  const format: ContentFormat = coerceFormatForPlatform(platform, parsed.data.format);
  const target = contentBodyCharTarget(platform, format);
  const charLimit = contentVariantCharLimit(platform, format);

  const query = [
    parsed.data.title,
    parsed.data.angle,
    parsed.data.proofHint ?? "",
    parsed.data.pillarKey,
  ].join(" ");

  const { ragBlock, chunks, knowledgePackContext } = await retrieveContentKnowledgeServer({
    organizationId: orgId,
    brand,
    query,
    ragMode,
    publicSafeOnly: true,
    topK: 6,
  });

  const sourcePost =
    parsed.data.sourceBody?.trim() && parsed.data.sourcePlatform
      ? [
          `ADAPTING AN APPROVED POST (do not translate it line by line):`,
          `The brand already published or approved this ${CONTENT_PLATFORM_LABELS[parsed.data.sourcePlatform]} post. Keep the same underlying claim and proof, then rebuild it natively for ${CONTENT_PLATFORM_LABELS[platform]}: new hook, new structure, new length, and a different entry point into the idea. It must not read like the same post reformatted, and it must stand alone for someone who never saw the original.`,
          "",
          parsed.data.sourceBody.trim(),
        ].join("\n")
      : "";

  try {
    const result = await runAiStructuredFeature({
      organizationId: orgId,
      userId: uid,
      userDisplayName: g.ctx.session.name,
      roleId,
      feature: "content_draft_generate",
      schema: draftSchema,
      promptVars: {
        brandContext: formatBrandContextForPrompt(brand),
        knowledgePackContext,
        playbook: formatPlatformPlaybookForPrompt(platform, format),
        platform,
        format,
        pillarKey: parsed.data.pillarKey,
        title: parsed.data.title,
        angle: parsed.data.angle,
        proofHint: parsed.data.proofHint ?? "",
        ctaType: parsed.data.ctaType,
        audienceHint: parsed.data.audienceHint?.trim() || brand.targetAudience || "not set",
        charTarget: `${target.min} to ${target.max}`,
        charLimit: String(charLimit),
        sourcePost,
        ragBlock,
        strategyExtras: pack.promptSystemExtras,
      },
    });

    const body = clampPostBody(scrubPostBody(result.body, platform), charLimit);
    const hashtags = normalizeHashtags(result.hashtags, playbook.hashtags.max);
    const segments = formatUsesSegments(platform, format)
      ? result.segments
          .map((s) => scrubPostBody(s, platform))
          .filter(Boolean)
          .map((s) => (platform === "x" && format === "thread" ? clampPostBody(s, 280) : s))
      : [];

    const citations =
      result.citations.length > 0
        ? result.citations
        : chunks.slice(0, 3).map((c) => ({
            title: c.title,
            excerpt: c.content.slice(0, 240),
          }));

    const lint = lintContentVariant({
      platform,
      format,
      body,
      hashtags,
      segments,
      bannedPhrases: brand.bannedPhrases,
    });

    return NextResponse.json({
      hook: scrubAiTellPunctuation(result.hook),
      body,
      format,
      hashtags,
      firstComment: scrubPostBody(result.firstComment, platform) || undefined,
      segments,
      altText: scrubAiTellPunctuation(result.altText) || undefined,
      postTitle:
        platform === "reddit" ? scrubAiTellPunctuation(result.postTitle) || undefined : undefined,
      citations,
      lint,
    });
  } catch (e) {
    return aiErrorResponse(e, {
      organizationId: g.ctx.session.organizationId,
      actorUid: g.ctx.session.uid,
      actorEmail: g.ctx.session.email,
      location: "src/app/api/ai/content-draft-generate/route.ts",
      functionName: "handler",
      route: "/api/ai/content-draft-generate",
    });
  }
}
