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
import {
  CONTENT_GRAPHICS_FORMATS,
  contentGraphicsSizeHint,
  type ContentFormat,
  type ContentPlatform,
} from "@/lib/content-calendar/types";
import type { Role } from "@/lib/types";

const PLATFORMS = ["linkedin", "x", "instagram", "reddit"] as const;
const FORMATS = [
  "text_post",
  "graphic_post",
  "thread",
  "carousel",
  "short_video",
  "long_form",
] as const;
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
  format: z.enum(FORMATS),
  pillarKey: z.enum(PILLARS),
  title: z.string().min(1).max(200),
  angle: z.string().min(1).max(800),
  ctaType: z.enum(CTAS),
  hook: z.string().max(300).optional(),
  body: z.string().max(12_000).optional(),
});

const briefSchema = z.object({
  designInstructions: z.string().min(1).max(2_000),
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

  const format = parsed.data.format as ContentFormat;
  if (!CONTENT_GRAPHICS_FORMATS.includes(format)) {
    return NextResponse.json(
      { error: "This format does not need a graphics brief." },
      { status: 400 },
    );
  }

  const orgId = g.ctx.session.organizationId;
  const uid = g.ctx.session.uid;
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const userSnap = await db.collection(COLLECTIONS.users).doc(uid).get();
  const roleId = (userSnap.data()?.roleId ?? "salesperson") as Role;

  const settings = await getOrganizationAiSettingsServer(orgId);
  if (!canUseAiFeature(settings, "content_graphics_brief", roleId)) {
    return NextResponse.json(
      { error: "Graphics brief AI is not enabled for your role." },
      { status: 403 },
    );
  }

  const brand = await getContentBrandServer(orgId, parsed.data.brandId);
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const pack = getContentStrategyPack(brand.strategyPackId);
  const featureCfg = settings.features.content_graphics_brief;
  const ragMode = featureCfg?.ragMode ?? "reference";
  const platform = parsed.data.platform as ContentPlatform;
  const sizeHint = contentGraphicsSizeHint(platform, format);

  const query = [
    parsed.data.title,
    parsed.data.angle,
    parsed.data.hook ?? "",
    parsed.data.body ?? "",
    parsed.data.pillarKey,
  ].join(" ");

  const { ragBlock } = await retrieveContentKnowledgeServer({
    organizationId: orgId,
    brand,
    query,
    ragMode,
    publicSafeOnly: true,
    topK: 4,
  });

  try {
    const result = await runAiStructuredFeature({
      organizationId: orgId,
      userId: uid,
      userDisplayName: g.ctx.session.name,
      roleId,
      feature: "content_graphics_brief",
      schema: briefSchema,
      promptVars: {
        brandContext: formatBrandContextForPrompt(brand),
        platform,
        format,
        sizeHint,
        pillarKey: parsed.data.pillarKey,
        title: parsed.data.title,
        angle: parsed.data.angle,
        ctaType: parsed.data.ctaType,
        hook: parsed.data.hook ?? "",
        body: parsed.data.body ?? "",
        ragBlock,
        strategyExtras: pack.promptSystemExtras,
      },
    });

    return NextResponse.json({
      designInstructions: scrubAiTellPunctuation(result.designInstructions.trim()),
    });
  } catch (e) {
    return aiErrorResponse(e);
  }
}
