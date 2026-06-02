import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import { getOrganizationAiSettingsServer, updateOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import {
  mergeFitCheckKnowledgeConfig,
  type FitCheckKnowledgeConfig,
  FIT_CHECK_LIBRARY_KIND_CATEGORY,
} from "@/lib/ai/fit-check-knowledge-types";
import type { OpportunitySourceType } from "@/lib/ai/opportunity-fit-types";

type RouteCtx = { params: Promise<{ libraryId: string }> };

async function deleteLibraryDocumentsAndChunks(input: {
  db: ReturnType<typeof getAdminDb>;
  orgId: string;
  libraryId: string;
}): Promise<void> {
  if (!input.db) return;

  const docsCol = input.db
    .collection(COLLECTIONS.organizations)
    .doc(input.orgId)
    .collection(ORG_SUBCOLLECTIONS.aiDocuments);

  const docsSnap = await docsCol.where("libraryId", "==", input.libraryId).get();
  for (const docSnap of docsSnap.docs) {
    // Delete all chunk docs under this document (in multiple batches to avoid batch limits).
    const chunksSnap = await docSnap.ref.collection("chunks").get();
    let idx = 0;
    while (idx < chunksSnap.docs.length) {
      const batch = input.db.batch();
      const slice = chunksSnap.docs.slice(idx, idx + 400); // keep comfortably under Firestore's 500 op limit
      for (const c of slice) batch.delete(c.ref);
      await batch.commit();
      idx += slice.length;
    }

    // Delete the document after its chunks.
    await docSnap.ref.delete();
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

  const lib = libSnap.data() as { libraryKind?: unknown; fitCategory?: unknown };
  const kind = String(lib.libraryKind ?? "");
  if (kind !== FIT_CHECK_LIBRARY_KIND_CATEGORY) {
    return NextResponse.json(
      { error: "Only Fit Check category libraries can be deleted" },
      { status: 400 },
    );
  }

  const fitCategory = lib.fitCategory as OpportunitySourceType | undefined;
  if (!fitCategory) {
    return NextResponse.json({ error: "Missing fitCategory on library" }, { status: 400 });
  }

  await deleteLibraryDocumentsAndChunks({ db, orgId, libraryId });
  await libRef.delete();

  // Also disable the category in Fit Check knowledge so it disappears from end-user Fit Check UI.
  const current = await getOrganizationAiSettingsServer(orgId);
  const merged = mergeFitCheckKnowledgeConfig(current.fitCheckKnowledge) as FitCheckKnowledgeConfig;
  merged.categories[fitCategory] = {
    ...merged.categories[fitCategory],
    enabled: false,
    libraryId: undefined,
  };

  const saveResult = await updateOrganizationAiSettingsServer(orgId, {
    fitCheckKnowledge: merged,
  });
  if ("error" in saveResult) {
    return NextResponse.json({ error: saveResult.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, disabledCategory: fitCategory });
}

