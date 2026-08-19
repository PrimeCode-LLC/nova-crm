import { NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import {
  getOrganizationAiSettingsServer,
  updateOrganizationAiSettingsServer,
} from "@/lib/ai/ai-settings-server";
import {
  mergeFitCheckKnowledgeConfig,
  type FitCheckKnowledgeConfig,
  FIT_CHECK_LIBRARY_KIND_CATEGORY,
  FIT_CHECK_LIBRARY_KIND_GLOBAL,
} from "@/lib/ai/fit-check-knowledge-types";
import type { OpportunitySourceType } from "@/lib/ai/opportunity-fit-types";
import type { AiKnowledgeLibrary, AiLibraryAllowedFeature, AiLibraryScope } from "@/lib/ai/types";
import {
  defaultAllowedFeaturesForLibraryType,
  resolveKnowledgeLibraryType,
  type KnowledgeLibraryUiType,
} from "@/lib/ai/knowledge-library-ui";

export async function GET() {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  const db = getAdminDb();
  if (!db) return NextResponse.json({ libraries: [] });

  const snap = await db
    .collection(COLLECTIONS.organizations)
    .doc(g.ctx.session.organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiLibraries)
    .get();

  const libraries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return NextResponse.json({ libraries });
}

const featureSchema = z.enum([
  "content",
  "outreach",
  "fit_check",
  "intent_radar",
  "lead_ai",
]);

const createSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    allowedFeatures: z.array(featureSchema).min(1).max(10).optional(),
    libraryType: z.enum(["company", "channel", "brand", "topic"]).optional(),
    brandId: z.string().min(1).optional(),
    fitCategory: z.string().min(1).optional(),
    /** Legacy: callers may still send org scope; ignored when libraryType is set. */
    scope: z
      .object({
        type: z.enum(["org", "channel", "profile", "campaign"]),
        channelKey: z.string().optional(),
        profileId: z.string().optional(),
        campaignId: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    const type = data.libraryType ?? "topic";
    if (type === "brand" && !data.brandId) {
      ctx.addIssue({
        code: "custom",
        message: "brandId is required for brand pack",
        path: ["brandId"],
      });
    }
    if (type === "channel" && !data.fitCategory) {
      ctx.addIssue({
        code: "custom",
        message: "fitCategory is required for channel pack",
        path: ["fitCategory"],
      });
    }
  });

export async function POST(req: Request) {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const orgId = g.ctx.session.organizationId;
  const libsCol = db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.aiLibraries);

  const libraryType: KnowledgeLibraryUiType = parsed.data.libraryType ?? "topic";
  const now = new Date().toISOString();
  const ref = libsCol.doc();

  let scope: AiLibraryScope = { type: "org" };
  let libraryKind: string | undefined;
  let fitCategory: OpportunitySourceType | undefined;

  if (libraryType === "company") {
    const others = await libsCol.get();
    const conflict = others.docs.some(
      (d) =>
        resolveKnowledgeLibraryType({
          name: d.data().name as string | undefined,
          libraryKind: d.data().libraryKind as string | undefined,
          scope: d.data().scope as { type?: string } | undefined,
        }) === "company",
    );
    if (conflict) {
      return NextResponse.json(
        { error: "A company library already exists. Edit that one instead." },
        { status: 400 },
      );
    }
    libraryKind = FIT_CHECK_LIBRARY_KIND_GLOBAL;
    scope = { type: "org" };
  } else if (libraryType === "channel") {
    fitCategory = parsed.data.fitCategory as OpportunitySourceType;
    libraryKind = FIT_CHECK_LIBRARY_KIND_CATEGORY;
    scope = { type: "org" };
  } else if (libraryType === "brand") {
    const brandId = parsed.data.brandId!;
    const brandSnap = await db.collection(COLLECTIONS.contentBrands).doc(brandId).get();
    if (!brandSnap.exists || brandSnap.data()?.organizationId !== orgId) {
      return NextResponse.json({ error: "Brand not found" }, { status: 400 });
    }
    libraryKind = "content_brand";
    scope = { type: "content_brand", brandId };
  } else if (parsed.data.scope) {
    scope = parsed.data.scope as AiLibraryScope;
  }

  const allowedFeatures: AiLibraryAllowedFeature[] =
    parsed.data.allowedFeatures ?? defaultAllowedFeaturesForLibraryType(libraryType);

  const lib: AiKnowledgeLibrary = {
    id: ref.id,
    organizationId: orgId,
    name: parsed.data.name,
    ...(parsed.data.description != null && parsed.data.description !== ""
      ? { description: parsed.data.description }
      : {}),
    scope,
    documentCount: 0,
    chunkCount: 0,
    createdAt: now,
    updatedAt: now,
    allowedFeatures,
    ...(libraryKind ? { libraryKind } : {}),
    ...(fitCategory ? { fitCategory } : {}),
  };

  await ref.set(lib);

  if (libraryType === "company" || libraryType === "channel") {
    const current = await getOrganizationAiSettingsServer(orgId);
    const merged = mergeFitCheckKnowledgeConfig(current.fitCheckKnowledge) as FitCheckKnowledgeConfig;
    if (libraryType === "company") {
      merged.globalLibraryId = ref.id;
    } else if (fitCategory) {
      merged.categories[fitCategory] = {
        ...merged.categories[fitCategory],
        libraryId: ref.id,
        enabled: merged.categories[fitCategory]?.enabled ?? true,
      };
    }
    const saveResult = await updateOrganizationAiSettingsServer(orgId, {
      fitCheckKnowledge: merged,
    });
    if ("error" in saveResult) {
      return NextResponse.json({ error: saveResult.error }, { status: 500 });
    }
  }

  return NextResponse.json({ library: lib });
}
