import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import { getOrganizationAiSettingsServer, updateOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import {
  mergeFitCheckKnowledgeConfig,
  type FitCheckKnowledgeConfig,
  FIT_CHECK_LIBRARY_KIND_CATEGORY,
  FIT_CHECK_LIBRARY_KIND_GLOBAL,
  FIT_CHECK_LIBRARY_KIND_LEGACY,
} from "@/lib/ai/fit-check-knowledge-types";
import type { OpportunitySourceType } from "@/lib/ai/opportunity-fit-types";
import type { AiLibraryAllowedFeature } from "@/lib/ai/types";
import { resolveKnowledgeLibraryType } from "@/lib/ai/knowledge-library-ui";

type RouteCtx = { params: Promise<{ libraryId: string }> };

const patchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(500).nullable().optional(),
    allowedFeatures: z
      .array(z.enum(["content", "outreach", "fit_check", "intent_radar", "lead_ai"]))
      .min(1)
      .max(10)
      .optional(),
    libraryType: z.enum(["company", "channel", "brand", "topic"]).optional(),
    brandId: z.string().min(1).optional(),
    fitCategory: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.libraryType === "brand" && !data.brandId) {
      ctx.addIssue({
        code: "custom",
        message: "brandId is required for brand pack",
        path: ["brandId"],
      });
    }
    if (data.libraryType === "channel" && !data.fitCategory) {
      ctx.addIssue({
        code: "custom",
        message: "fitCategory is required for channel pack",
        path: ["fitCategory"],
      });
    }
  });

export async function PATCH(req: Request, ctx: RouteCtx) {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  const { libraryId } = await ctx.params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(json);
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
  const libRef = libsCol.doc(libraryId);

  const libSnap = await libRef.get();
  if (!libSnap.exists) {
    return NextResponse.json({ error: "Library not found" }, { status: 404 });
  }

  const existing = libSnap.data() as {
    name?: string;
    libraryKind?: string;
    fitCategory?: string;
    scope?: { type?: string; brandId?: string };
  };

  const patch: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.description !== undefined) {
    patch.description = parsed.data.description === null ? "" : parsed.data.description;
  }
  if (parsed.data.allowedFeatures !== undefined) {
    patch.allowedFeatures = parsed.data.allowedFeatures as AiLibraryAllowedFeature[];
  }

  if (parsed.data.libraryType !== undefined) {
    const nextType = parsed.data.libraryType;

    if (nextType === "company") {
      const others = await libsCol.get();
      const conflict = others.docs.find((d) => {
        if (d.id === libraryId) return false;
        return resolveKnowledgeLibraryType({
          name: d.data().name as string | undefined,
          libraryKind: d.data().libraryKind as string | undefined,
          scope: d.data().scope as { type?: string } | undefined,
        }) === "company";
      });
      if (conflict) {
        return NextResponse.json(
          { error: "Another company library already exists. Rename or delete it first." },
          { status: 400 },
        );
      }
      patch.libraryKind = FIT_CHECK_LIBRARY_KIND_GLOBAL;
      patch.scope = { type: "org" };
      patch.fitCategory = FieldValue.delete();
    } else if (nextType === "channel") {
      const fitCategory = parsed.data.fitCategory as OpportunitySourceType;
      patch.libraryKind = FIT_CHECK_LIBRARY_KIND_CATEGORY;
      patch.fitCategory = fitCategory;
      patch.scope = { type: "org" };
    } else if (nextType === "brand") {
      const brandId = parsed.data.brandId!;
      const brandSnap = await db.collection(COLLECTIONS.contentBrands).doc(brandId).get();
      if (!brandSnap.exists || brandSnap.data()?.organizationId !== orgId) {
        return NextResponse.json({ error: "Brand not found" }, { status: 400 });
      }
      patch.libraryKind = "content_brand";
      patch.scope = { type: "content_brand", brandId };
      patch.fitCategory = FieldValue.delete();
    } else {
      // topic
      patch.libraryKind = FieldValue.delete();
      patch.fitCategory = FieldValue.delete();
      patch.scope = { type: "org" };
    }

    // Keep Fit Check config pointers in sync when leaving/entering company or channel.
    const current = await getOrganizationAiSettingsServer(orgId);
    const merged = mergeFitCheckKnowledgeConfig(current.fitCheckKnowledge) as FitCheckKnowledgeConfig;
    let configDirty = false;
    const prevType = resolveKnowledgeLibraryType(existing);

    if (prevType === "company" && nextType !== "company" && merged.globalLibraryId === libraryId) {
      merged.globalLibraryId = undefined;
      configDirty = true;
    }
    if (nextType === "company") {
      merged.globalLibraryId = libraryId;
      configDirty = true;
    }
    if (prevType === "channel" && existing.fitCategory) {
      const cat = existing.fitCategory as OpportunitySourceType;
      if (merged.categories[cat]?.libraryId === libraryId && nextType !== "channel") {
        merged.categories[cat] = {
          ...merged.categories[cat],
          libraryId: undefined,
        };
        configDirty = true;
      }
    }
    if (nextType === "channel" && parsed.data.fitCategory) {
      const cat = parsed.data.fitCategory as OpportunitySourceType;
      merged.categories[cat] = {
        ...merged.categories[cat],
        libraryId,
        enabled: merged.categories[cat]?.enabled ?? true,
      };
      configDirty = true;
    }

    if (configDirty) {
      const saveResult = await updateOrganizationAiSettingsServer(orgId, {
        fitCheckKnowledge: merged,
      });
      if ("error" in saveResult) {
        return NextResponse.json({ error: saveResult.error }, { status: 500 });
      }
    }
  }

  await libRef.set(patch, { merge: true });
  const updated = await libRef.get();
  return NextResponse.json({ library: { id: updated.id, ...updated.data() } });
}

async function deleteLibraryDocumentsAndChunks(input: {
  db: NonNullable<ReturnType<typeof getAdminDb>>;
  orgId: string;
  libraryId: string;
}): Promise<void> {
  const docsCol = input.db
    .collection(COLLECTIONS.organizations)
    .doc(input.orgId)
    .collection(ORG_SUBCOLLECTIONS.aiDocuments);

  const docsSnap = await docsCol.where("libraryId", "==", input.libraryId).get();
  for (const docSnap of docsSnap.docs) {
    const chunksSnap = await docSnap.ref.collection("chunks").get();
    let idx = 0;
    while (idx < chunksSnap.docs.length) {
      const batch = input.db.batch();
      const slice = chunksSnap.docs.slice(idx, idx + 400);
      for (const c of slice) batch.delete(c.ref);
      await batch.commit();
      idx += slice.length;
    }
    await docSnap.ref.delete();
  }
}

async function unlinkLibraryFromConsumers(input: {
  db: NonNullable<ReturnType<typeof getAdminDb>>;
  orgId: string;
  libraryId: string;
}): Promise<void> {
  const brandSnap = await input.db
    .collection(COLLECTIONS.contentBrands)
    .where("organizationId", "==", input.orgId)
    .where("knowledgeLibraryIds", "array-contains", input.libraryId)
    .get();

  for (const doc of brandSnap.docs) {
    await doc.ref.update({
      knowledgeLibraryIds: FieldValue.arrayRemove(input.libraryId),
      updatedAt: new Date().toISOString(),
    });
  }

  const profileSnap = await input.db
    .collection(COLLECTIONS.profiles)
    .where("organizationId", "==", input.orgId)
    .where("knowledgeLibraryIds", "array-contains", input.libraryId)
    .get();

  for (const doc of profileSnap.docs) {
    await doc.ref.update({
      knowledgeLibraryIds: FieldValue.arrayRemove(input.libraryId),
      updatedAt: new Date().toISOString(),
    });
  }
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  const { libraryId } = await ctx.params;

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const orgId = g.ctx.session.organizationId;

  const libRef = db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.aiLibraries)
    .doc(libraryId);

  const libSnap = await libRef.get();
  if (!libSnap.exists) {
    return NextResponse.json({ error: "Library not found" }, { status: 404 });
  }

  const lib = libSnap.data() as {
    name?: string;
    libraryKind?: string;
    fitCategory?: string;
    scope?: { type?: string; brandId?: string };
  };
  const kind = String(lib.libraryKind ?? "");
  const uiType = resolveKnowledgeLibraryType(lib);

  if (
    uiType === "company" ||
    kind === FIT_CHECK_LIBRARY_KIND_GLOBAL ||
    kind === FIT_CHECK_LIBRARY_KIND_LEGACY
  ) {
    return NextResponse.json(
      {
        error:
          "Company knowledge cannot be deleted. Re-index from Overview, or disable retrieval instead.",
      },
      { status: 400 },
    );
  }

  await deleteLibraryDocumentsAndChunks({ db, orgId, libraryId });
  await unlinkLibraryFromConsumers({ db, orgId, libraryId });
  await libRef.delete();

  // Keep Fit Check config in sync when removing a channel pack or clearing a stale id.
  const current = await getOrganizationAiSettingsServer(orgId);
  const merged = mergeFitCheckKnowledgeConfig(current.fitCheckKnowledge) as FitCheckKnowledgeConfig;
  let configDirty = false;

  if (kind === FIT_CHECK_LIBRARY_KIND_CATEGORY) {
    const fitCategory = lib.fitCategory as OpportunitySourceType | undefined;
    if (fitCategory) {
      merged.categories[fitCategory] = {
        ...merged.categories[fitCategory],
        enabled: false,
        libraryId: undefined,
      };
      configDirty = true;
    }
  }

  if (merged.globalLibraryId === libraryId) {
    merged.globalLibraryId = undefined;
    configDirty = true;
  }

  for (const cat of Object.keys(merged.categories) as OpportunitySourceType[]) {
    if (merged.categories[cat]?.libraryId === libraryId) {
      merged.categories[cat] = {
        ...merged.categories[cat],
        libraryId: undefined,
      };
      configDirty = true;
    }
  }

  if (configDirty) {
    const saveResult = await updateOrganizationAiSettingsServer(orgId, {
      fitCheckKnowledge: merged,
    });
    if ("error" in saveResult) {
      return NextResponse.json({ error: saveResult.error }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    deletedLibraryId: libraryId,
    type: uiType,
  });
}
