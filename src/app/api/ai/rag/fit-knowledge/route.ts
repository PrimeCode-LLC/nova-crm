import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import {
  getOrganizationAiSettingsServer,
  updateOrganizationAiSettingsServer,
} from "@/lib/ai/ai-settings-server";
import {
  mergeFitCheckKnowledgeConfig,
  OPPORTUNITY_SOURCE_TYPES,
  type FitCheckKnowledgeConfig,
} from "@/lib/ai/fit-check-knowledge-types";
import {
  FIT_CHECK_LIBRARY_KIND_CATEGORY,
  FIT_CHECK_LIBRARY_KIND_GLOBAL,
  FIT_CHECK_LIBRARY_KIND_LEGACY,
} from "@/lib/ai/fit-check-knowledge-types";
import { probeRagVectorHealthServer } from "@/lib/ai/rag-vector-health";

export async function GET() {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  const orgId = g.ctx.session.organizationId;
  const settings = await getOrganizationAiSettingsServer(orgId);
  const config = mergeFitCheckKnowledgeConfig(settings.fitCheckKnowledge);

  const db = getAdminDb();
  const libraries: {
    id: string;
    name: string;
    libraryKind?: string;
    fitCategory?: string;
    documentCount?: number;
    chunkCount?: number;
  }[] = [];

  if (db) {
    const snap = await db
      .collection(COLLECTIONS.organizations)
      .doc(orgId)
      .collection(ORG_SUBCOLLECTIONS.aiLibraries)
      .get();

    const docsCol = db
      .collection(COLLECTIONS.organizations)
      .doc(orgId)
      .collection(ORG_SUBCOLLECTIONS.aiDocuments);

    for (const doc of snap.docs) {
      const d = doc.data();
      const kind = d.libraryKind as string | undefined;
      if (
        kind === FIT_CHECK_LIBRARY_KIND_GLOBAL ||
        kind === FIT_CHECK_LIBRARY_KIND_CATEGORY ||
        kind === FIT_CHECK_LIBRARY_KIND_LEGACY
      ) {
        const docSnap = await docsCol.where("libraryId", "==", doc.id).get();
        let chunkTotal = 0;
        for (const ds of docSnap.docs) {
          chunkTotal += (ds.data().chunkCount as number | undefined) ?? 0;
        }
        libraries.push({
          id: doc.id,
          name: String(d.name ?? ""),
          libraryKind: kind,
          fitCategory: d.fitCategory as string | undefined,
          documentCount: docSnap.size,
          chunkCount: chunkTotal || (d.chunkCount as number | undefined),
        });
      }
    }
  }

  const vectorHealth = await probeRagVectorHealthServer(orgId);
  return NextResponse.json({ config, libraries, vectorHealth });
}

const categorySchema = z.object({
  enabled: z.boolean().optional(),
  useGlobal: z.boolean().optional(),
});

const patchSchema = z.object({
  globalEnabled: z.boolean().optional(),
  retrievalBudget: z
    .object({
      globalChunks: z.number().int().min(0).max(12).optional(),
      categoryChunks: z.number().int().min(0).max(12).optional(),
    })
    .optional(),
  categories: z.record(z.string(), categorySchema).optional(),
});

export async function PATCH(req: Request) {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

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

  const orgId = g.ctx.session.organizationId;
  const current = await getOrganizationAiSettingsServer(orgId);
  const merged = mergeFitCheckKnowledgeConfig(current.fitCheckKnowledge);

  if (parsed.data.globalEnabled !== undefined) {
    merged.globalEnabled = parsed.data.globalEnabled;
  }
  if (parsed.data.retrievalBudget) {
    merged.retrievalBudget = {
      ...merged.retrievalBudget,
      ...parsed.data.retrievalBudget,
    };
  }
  if (parsed.data.categories) {
    for (const key of OPPORTUNITY_SOURCE_TYPES) {
      const patch = parsed.data.categories[key];
      if (patch) {
        merged.categories[key] = { ...merged.categories[key], ...patch };
      }
    }
  }

  const result = await updateOrganizationAiSettingsServer(orgId, {
    fitCheckKnowledge: merged as FitCheckKnowledgeConfig,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ config: merged });
}
