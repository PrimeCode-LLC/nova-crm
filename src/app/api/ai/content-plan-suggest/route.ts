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
import {
  buildContentScheduleSlots,
  scrubAiTellPunctuation,
} from "@/lib/content-calendar/schedule";
import {
  coerceFormatForPlatform,
  formatPlatformFitForPrompt,
} from "@/lib/content-calendar/platform-playbooks";
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
  /** Inclusive window start as YYYY-MM-DD. Defaults to tomorrow (or today before 10:00). */
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD")
    .optional(),
});

const slotSchema = z.object({
  publishAt: z.string().min(1),
  platform: z.enum(PLATFORMS),
  pillarKey: z.enum(PILLARS),
  title: z.string().min(1).max(200),
  angle: z.string().min(1).max(800),
  // OpenAI structured output requires every property to be in `required`
  // (optional Zod fields are rejected with invalid_json_schema).
  proofHint: z.string().max(500),
  ctaType: z.enum(CTAS),
  rationale: z.string().max(500),
  format: z.enum(FORMATS),
  targetAudienceHint: z.string().max(300),
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

  const platforms = parsed.data.platforms.filter((p) => brand.platforms.includes(p));
  if (platforms.length === 0) {
    return NextResponse.json(
      { error: "Select at least one platform that this brand supports." },
      { status: 400 },
    );
  }

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

  const schedule = buildContentScheduleSlots({
    startDate,
    dayCount: parsed.data.dayCount,
    platforms,
    cadence: brand.cadence,
  });
  if (schedule.length === 0) {
    return NextResponse.json(
      {
        error:
          "No publish days in this window for the brand's preferred weekdays. Widen the range or adjust cadence weekdays.",
      },
      { status: 400 },
    );
  }

  const scheduleRows = schedule
    .map(
      (s, i) =>
        `${i + 1}. publishAt=${s.publishAt} platform=${s.platform}`,
    )
    .join("\n");

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
        platformFit: formatPlatformFitForPrompt(platforms),
        pillars: brand.pillars
          .filter((p) => p.enabled)
          .map((p) => `${p.key}: ${p.targetPercent}%`)
          .join(", "),
        cadence: JSON.stringify(brand.cadence),
        platforms: platforms.join(", "),
        dayCount: String(parsed.data.dayCount),
        startDate,
        scheduleRows,
        recentAngles: (parsed.data.recentAngles ?? []).join("\n") || "none",
        ragBlock,
        userPrompt: [
          parsed.data.userPrompt?.trim(),
          `Authoritative schedule (fill in this order; keep publishAt + platform):\n${scheduleRows}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        strategyExtras: pack.promptSystemExtras,
      },
    });

    const now = new Date().toISOString();
    const ideaCount = Math.min(result.slots.length, schedule.length);
    const slots: ContentPlanSlot[] = [];
    for (let i = 0; i < ideaCount; i++) {
      const s = result.slots[i]!;
      const sched = schedule[i]!;
      slots.push({
        id: newId("slot"),
        publishAt: sched.publishAt,
        platform: sched.platform,
        pillarKey: s.pillarKey,
        title: scrubAiTellPunctuation(s.title),
        angle: scrubAiTellPunctuation(s.angle),
        proofHint: scrubAiTellPunctuation(s.proofHint),
        ctaType: s.ctaType,
        rationale: scrubAiTellPunctuation(s.rationale),
        // Guard against a plan asking for a format the platform cannot publish.
        format: coerceFormatForPlatform(sched.platform, s.format),
        targetAudienceHint: scrubAiTellPunctuation(s.targetAudienceHint),
        approved: true,
      });
    }

    if (slots.length === 0) {
      return NextResponse.json({ error: "AI returned no usable plan slots." }, { status: 502 });
    }

    const plan: ContentPlan = {
      id: newId("cplan"),
      organizationId: orgId,
      brandId: brand.id,
      startDate,
      endDate: end.toISOString().slice(0, 10),
      dayCount: parsed.data.dayCount,
      platforms,
      status: "draft",
      planSummary: scrubAiTellPunctuation(result.planSummary),
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
