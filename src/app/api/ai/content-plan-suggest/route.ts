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
import type { ContentPlan, ContentPlanSlot } from "@/lib/content-calendar/types";
import type { Role } from "@/lib/types";

const PLATFORMS = ["linkedin", "x", "instagram", "reddit"] as const;
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
  dayCount: z.number().int().min(3).max(21),
  platforms: z.array(z.enum(PLATFORMS)).min(1).max(4),
  userPrompt: z.string().max(800).optional(),
  recentAngles: z.array(z.string().max(300)).max(40).optional(),
  startDate: z.string().optional(),
});

const slotSchema = z.object({
  publishAt: z.string().min(1),
  platform: z.enum(PLATFORMS),
  pillarKey: z.enum(PILLARS),
  title: z.string().min(1).max(200),
  angle: z.string().min(1).max(800),
  proofHint: z.string().max(500).optional().default(""),
  ctaType: z.enum(CTAS),
  rationale: z.string().max(500).optional().default(""),
  format: z.enum(FORMATS).optional().default("text_post"),
  targetAudienceHint: z.string().max(300).optional().default(""),
});

const planSchema = z.object({
  planSummary: z.string(),
  slots: z.array(slotSchema).min(1).max(60),
});

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function defaultStartDate(): string {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
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
  if (!canUseAiFeature(settings, "content_plan_suggest", roleId)) {
    return NextResponse.json(
      { error: "Content plan AI is not enabled for your role." },
      { status: 403 },
    );
  }

  const brand = await getContentBrandServer(orgId, parsed.data.brandId);
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const pack = getContentStrategyPack(brand.strategyPackId);
  const startDate = parsed.data.startDate || defaultStartDate();
  const featureCfg = settings.features.content_plan_suggest;
  const ragMode = featureCfg?.ragMode ?? "reference";

  const { ragBlock } = await retrieveContentKnowledgeServer({
    organizationId: orgId,
    brand,
    query: `${brand.positioning} ${parsed.data.userPrompt ?? ""} case study lessons`,
    ragMode,
    publicSafeOnly: true,
    topK: 8,
  });

  const end = new Date(startDate);
  end.setDate(end.getDate() + parsed.data.dayCount - 1);

  try {
    const result = await runAiStructuredFeature({
      organizationId: orgId,
      userId: uid,
      userDisplayName: g.ctx.session.name,
      roleId,
      feature: "content_plan_suggest",
      schema: planSchema,
      promptVars: {
        brandContext: formatBrandContextForPrompt(brand),
        pillars: brand.pillars
          .filter((p) => p.enabled)
          .map((p) => `${p.key}: ${p.targetPercent}%`)
          .join(", "),
        cadence: JSON.stringify(brand.cadence),
        platforms: parsed.data.platforms.join(", "),
        dayCount: String(parsed.data.dayCount),
        startDate,
        recentAngles: (parsed.data.recentAngles ?? []).join("\n") || "none",
        ragBlock,
        userPrompt: parsed.data.userPrompt ?? "",
        strategyExtras: pack.promptSystemExtras,
      },
    });

    const now = new Date().toISOString();
    const slots: ContentPlanSlot[] = result.slots.map((s) => ({
      id: newId("slot"),
      publishAt: s.publishAt,
      platform: s.platform,
      pillarKey: s.pillarKey,
      title: s.title,
      angle: s.angle,
      proofHint: s.proofHint,
      ctaType: s.ctaType,
      rationale: s.rationale,
      format: s.format,
      targetAudienceHint: s.targetAudienceHint,
      approved: true,
    }));

    const plan: ContentPlan = {
      id: newId("cplan"),
      organizationId: orgId,
      brandId: brand.id,
      startDate,
      endDate: end.toISOString().slice(0, 10),
      dayCount: parsed.data.dayCount,
      platforms: parsed.data.platforms,
      status: "draft",
      planSummary: result.planSummary,
      slots,
      createdById: uid,
      createdAt: now,
      updatedAt: now,
    };

    await db.collection(COLLECTIONS.contentPlans).doc(plan.id).set(plan);

    return NextResponse.json({ plan });
  } catch (e) {
    return aiErrorResponse(e);
  }
}
