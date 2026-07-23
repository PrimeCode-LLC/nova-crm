import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { aiErrorResponse } from "@/lib/ai/ai-route-errors";
import { runAiStructuredFeature } from "@/lib/ai/run-feature";
import { canUseAiFeature, getOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  formatBrandContextForPrompt,
  getContentBrandServer,
  retrieveContentKnowledgeServer,
} from "@/lib/ai/content-knowledge-server";
import { getContentStrategyPack } from "@/lib/content-calendar/strategy-packs";
import { scrubAiTellPunctuation } from "@/lib/content-calendar/schedule";
import { contentVariantCharLimit } from "@/lib/content-calendar/types";
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

const bodySchema = z.object({
  brandId: z.string().min(1),
  platform: z.enum(PLATFORMS),
  pillarKey: z.enum(PILLARS),
  title: z.string().min(1).max(200),
  angle: z.string().min(1).max(800),
  proofHint: z.string().max(500).optional(),
  ctaType: z.enum(CTAS),
});

const draftSchema = z.object({
  hook: z.string().max(300),
  body: z.string().min(1).max(12_000),
  citations: z
    .array(
      z.object({
        title: z.string().max(200),
        excerpt: z.string().max(500),
      }),
    )
    .max(8),
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
  const charLimit = contentVariantCharLimit(parsed.data.platform);

  const query = [
    parsed.data.title,
    parsed.data.angle,
    parsed.data.proofHint ?? "",
    parsed.data.pillarKey,
  ].join(" ");

  const { ragBlock, chunks } = await retrieveContentKnowledgeServer({
    organizationId: orgId,
    brand,
    query,
    ragMode,
    publicSafeOnly: true,
    topK: 6,
  });

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
        platform: parsed.data.platform,
        pillarKey: parsed.data.pillarKey,
        title: parsed.data.title,
        angle: parsed.data.angle,
        proofHint: parsed.data.proofHint ?? "",
        ctaType: parsed.data.ctaType,
        charLimit: String(charLimit),
        ragBlock,
        strategyExtras: pack.promptSystemExtras,
      },
    });

    let body = scrubAiTellPunctuation(result.body.trim());
    if (body.length > charLimit + 40) {
      body = body.slice(0, charLimit - 1) + "...";
    }

    const citations =
      result.citations.length > 0
        ? result.citations
        : chunks.slice(0, 3).map((c) => ({
            title: c.title,
            excerpt: c.content.slice(0, 240),
          }));

    return NextResponse.json({
      hook: scrubAiTellPunctuation(result.hook),
      body,
      citations,
    });
  } catch (e) {
    return aiErrorResponse(e);
  }
}
