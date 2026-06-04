import { NextResponse } from "next/server";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import {
  FIT_CHECK_LIBRARY_KIND_CATEGORY,
  FIT_CHECK_LIBRARY_KIND_GLOBAL,
  FIT_CHECK_LIBRARY_KIND_LEGACY,
  KNOWLEDGE_SECTION_LABELS,
  type KnowledgeSection,
} from "@/lib/ai/fit-check-knowledge-types";
import { OPPORTUNITY_SOURCE_LABELS, type OpportunitySourceType } from "@/lib/ai/opportunity-fit-types";
import type {
  LinkableKnowledgeDocument,
  LinkableKnowledgeGroup,
  LinkableKnowledgeLibrary,
} from "@/lib/ai/linkable-knowledge-types";

export type {
  LinkableKnowledgeDocument,
  LinkableKnowledgeGroup,
  LinkableKnowledgeLibrary,
} from "@/lib/ai/linkable-knowledge-types";

function libraryGroup(
  kind: string | undefined,
): { id: string; label: string } {
  if (kind === FIT_CHECK_LIBRARY_KIND_GLOBAL || kind === FIT_CHECK_LIBRARY_KIND_LEGACY) {
    return { id: "global", label: "Global company knowledge" };
  }
  if (kind === FIT_CHECK_LIBRARY_KIND_CATEGORY) {
    return { id: "category", label: "Category playbooks" };
  }
  return { id: "custom", label: "Custom libraries" };
}

/** Full knowledge tree for profile linking — all libraries and documents. */
export async function GET() {
  const gProfiles = await guardAdminFeature("profiles");
  const gAi = gProfiles.ok ? gProfiles : await guardAdminFeature("ai_knowledge");
  const g = gProfiles.ok ? gProfiles : gAi;
  if (!g.ok) return g.response;

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ groups: [], libraries: [] });
  }

  const orgId = g.ctx.session.organizationId;
  const libsSnap = await db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.aiLibraries)
    .get();

  const docsCol = db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.aiDocuments);

  const libraries: LinkableKnowledgeLibrary[] = [];

  for (const libDoc of libsSnap.docs) {
    const d = libDoc.data();
    const kind = d.libraryKind as string | undefined;
    const fitCategory = d.fitCategory as OpportunitySourceType | undefined;
    const docSnap = await docsCol.where("libraryId", "==", libDoc.id).limit(100).get();

    const documents: LinkableKnowledgeDocument[] = docSnap.docs.map((doc) => {
      const section = doc.data().knowledgeSection as KnowledgeSection | undefined;
      return {
        id: doc.id,
        title: String(doc.data().title ?? "Untitled"),
        libraryId: libDoc.id,
        knowledgeSection: section ?? null,
        sectionLabel: section ? KNOWLEDGE_SECTION_LABELS[section] : "Other",
        chunkCount: Number(doc.data().chunkCount ?? 0),
      };
    });

    documents.sort((a, b) => a.title.localeCompare(b.title));

    let chunkTotal = 0;
    for (const doc of documents) chunkTotal += doc.chunkCount;

    libraries.push({
      id: libDoc.id,
      name: String(d.name ?? "Library"),
      description: d.description as string | undefined,
      libraryKind: kind,
      fitCategory,
      fitCategoryLabel: fitCategory ? OPPORTUNITY_SOURCE_LABELS[fitCategory] : undefined,
      documentCount: documents.length,
      chunkCount: chunkTotal || Number(d.chunkCount ?? 0),
      documents,
    });
  }

  libraries.sort((a, b) => a.name.localeCompare(b.name));

  const groupMap = new Map<string, LinkableKnowledgeGroup>();
  for (const lib of libraries) {
    const { id, label } = libraryGroup(lib.libraryKind);
    let group = groupMap.get(id);
    if (!group) {
      group = { id, label, libraries: [] };
      groupMap.set(id, group);
    }
    group.libraries.push(lib);
  }

  const groupOrder = ["global", "category", "custom"];
  const groups = groupOrder
    .map((id) => groupMap.get(id))
    .filter((g): g is LinkableKnowledgeGroup => !!g && g.libraries.length > 0);

  return NextResponse.json({ groups, libraries });
}
