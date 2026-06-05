import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import {
  getOrganizationAiSettingsServer,
  updateOrganizationAiSettingsServer,
} from "@/lib/ai/ai-settings-server";
import { indexAiDocumentServer } from "@/lib/ai/rag-indexer";
import { fitCheckCategoryPlaybook } from "@/lib/ai/fit-check-category-playbooks";
import {
  mergeFitCheckKnowledgeConfig,
  FIT_CHECK_LIBRARY_KIND_CATEGORY,
  FIT_CHECK_LIBRARY_KIND_GLOBAL,
  FIT_CHECK_LIBRARY_KIND_LEGACY,
  type KnowledgeSection,
} from "@/lib/ai/fit-check-knowledge-types";
import { OPPORTUNITY_SOURCE_TYPES, OPPORTUNITY_SOURCE_LABELS } from "@/lib/ai/opportunity-fit-types";
import type { OpportunitySourceType } from "@/lib/ai/opportunity-fit-types";
import type { AiKnowledgeLibrary, AiLibraryScope } from "@/lib/ai/types";
import {
  crawlStellixSoftSite,
  pageToKnowledgeDocument,
  stellixSoftFitCheckProfileDoc,
  STELLIXSOFT_SITE_ORIGIN,
} from "@/lib/ai/stellixsoft-site-crawler";

export const FIT_CHECK_GLOBAL_LIBRARY_NAME = "Fit Check, Global (company)";
export const FIT_CHECK_CATEGORY_LIBRARY_PREFIX = "Fit Check, ";

export type SeedFitCheckLibraryResult = {
  globalLibraryId: string;
  categoryLibraryIds: Record<OpportunitySourceType, string>;
  documentsCreated: number;
  pagesCrawled: number;
  chunksIndexed: number;
  indexErrors: string[];
  configSaved: boolean;
};

export type SeedFitCheckCategoryResult = {
  category: OpportunitySourceType;
  categoryLibraryId: string;
  documentsCreated: number;
  chunksIndexed: number;
  indexErrors: string[];
  configSaved: boolean;
};

type DocPayload = {
  title: string;
  content: string;
  sourceRef?: string;
  knowledgeSection: KnowledgeSection;
};

function sectionFromUrl(url: string): KnowledgeSection {
  try {
    const p = new URL(url).pathname;
    if (p.includes("/case-studies")) return "case_studies";
    if (p.includes("/pricing")) return "pricing";
    if (p.includes("/services")) return "services";
    if (p.includes("/industries")) return "icp";
    if (p === "/" || p.includes("/about") || p.includes("/contact") || p.includes("/faqs")) {
      return "icp";
    }
    return "website";
  } catch {
    return "website";
  }
}

async function findLibrary(
  organizationId: string,
  kind: string,
  fitCategory?: OpportunitySourceType,
): Promise<string | null> {
  const db = getAdminDb();
  if (!db) return null;

  const col = db
    .collection(COLLECTIONS.organizations)
    .doc(organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiLibraries);

  if (kind === FIT_CHECK_LIBRARY_KIND_GLOBAL) {
    for (const k of [FIT_CHECK_LIBRARY_KIND_GLOBAL, FIT_CHECK_LIBRARY_KIND_LEGACY]) {
      const snap = await col.where("libraryKind", "==", k).limit(1).get();
      if (!snap.empty) return snap.docs[0]!.id;
    }
    const all = await col.get();
    const byName = all.docs.find((d) => d.data().name === FIT_CHECK_GLOBAL_LIBRARY_NAME);
    return byName?.id ?? null;
  }

  if (fitCategory) {
    const snap = await col
      .where("libraryKind", "==", FIT_CHECK_LIBRARY_KIND_CATEGORY)
      .where("fitCategory", "==", fitCategory)
      .limit(1)
      .get();
    if (!snap.empty) return snap.docs[0]!.id;
  }

  return null;
}

async function ensureLibrary(
  organizationId: string,
  input: {
    name: string;
    description: string;
    libraryKind: string;
    fitCategory?: OpportunitySourceType;
  },
): Promise<string> {
  const existing = await findLibrary(organizationId, input.libraryKind, input.fitCategory);
  if (existing) return existing;

  const db = getAdminDb();
  if (!db) throw new Error("Database not configured");

  const scope: AiLibraryScope = { type: "org" };
  const now = new Date().toISOString();
  const ref = db
    .collection(COLLECTIONS.organizations)
    .doc(organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiLibraries)
    .doc();

  const lib: AiKnowledgeLibrary = {
    id: ref.id,
    organizationId,
    name: input.name,
    description: input.description,
    scope,
    documentCount: 0,
    chunkCount: 0,
    createdAt: now,
    updatedAt: now,
    libraryKind: input.libraryKind,
    ...(input.fitCategory ? { fitCategory: input.fitCategory } : {}),
    ...(!input.fitCategory ? { seedSourceUrl: STELLIXSOFT_SITE_ORIGIN } : {}),
  };

  await ref.set(lib);
  return ref.id;
}

async function clearLibraryDocuments(organizationId: string, libraryId: string): Promise<void> {
  const db = getAdminDb();
  if (!db) return;

  const docsCol = db
    .collection(COLLECTIONS.organizations)
    .doc(organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiDocuments);

  const snap = await docsCol.where("libraryId", "==", libraryId).get();
  for (const docSnap of snap.docs) {
    const chunks = await docSnap.ref.collection("chunks").get();
    const batch = db.batch();
    for (const c of chunks.docs) batch.delete(c.ref);
    batch.delete(docSnap.ref);
    await batch.commit();
  }

  await db
    .collection(COLLECTIONS.organizations)
    .doc(organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiLibraries)
    .doc(libraryId)
    .set({ documentCount: 0, chunkCount: 0, updatedAt: new Date().toISOString() }, { merge: true });
}

async function addDocuments(
  organizationId: string,
  libraryId: string,
  userId: string,
  payloads: DocPayload[],
): Promise<{ documentsCreated: number; chunksIndexed: number; indexErrors: string[] }> {
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured");

  const docsCol = db
    .collection(COLLECTIONS.organizations)
    .doc(organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiDocuments);

  let documentsCreated = 0;
  let chunksIndexed = 0;
  const indexErrors: string[] = [];

  for (const doc of payloads) {
    const now = new Date().toISOString();
    const ref = docsCol.doc();
    await ref.set({
      libraryId,
      title: doc.title,
      content: doc.content,
      sourceType: "markdown",
      sourceRef: doc.sourceRef ?? null,
      knowledgeSection: doc.knowledgeSection,
      chunkCount: 0,
      organizationId,
      createdAt: now,
      updatedAt: now,
    });
    documentsCreated += 1;

    const indexed = await indexAiDocumentServer({
      organizationId,
      documentId: ref.id,
      userId,
    });
    if ("error" in indexed) {
      indexErrors.push(`${doc.title}: ${indexed.error}`);
    } else {
      chunksIndexed += indexed.chunkCount;
    }
  }

  const libRef = db
    .collection(COLLECTIONS.organizations)
    .doc(organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiLibraries)
    .doc(libraryId);

  const docSnap = await docsCol.where("libraryId", "==", libraryId).get();
  let chunkTotal = 0;
  for (const ds of docSnap.docs) {
    chunkTotal += (ds.data().chunkCount as number | undefined) ?? 0;
  }

  await libRef.set(
    {
      documentCount: docSnap.size,
      chunkCount: chunkTotal,
      lastIndexedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastSeededAt: new Date().toISOString(),
    },
    { merge: true },
  );

  return { documentsCreated, chunksIndexed, indexErrors };
}

export async function seedFitCheckLibraryServer(input: {
  organizationId: string;
  userId: string;
  rescrape?: boolean;
}): Promise<SeedFitCheckLibraryResult | { error: string }> {
  const globalLibraryId = await ensureLibrary(input.organizationId, {
    name: FIT_CHECK_GLOBAL_LIBRARY_NAME,
    description:
      "Global company knowledge for Fit Check, ICP, services, pricing, case studies (website crawled once).",
    libraryKind: FIT_CHECK_LIBRARY_KIND_GLOBAL,
  });

  const categoryLibraryIds = {} as Record<OpportunitySourceType, string>;
  for (const cat of OPPORTUNITY_SOURCE_TYPES) {
    categoryLibraryIds[cat] = await ensureLibrary(input.organizationId, {
      name: `${FIT_CHECK_CATEGORY_LIBRARY_PREFIX}${OPPORTUNITY_SOURCE_LABELS[cat]}`,
      description: `Category playbook and rules for ${OPPORTUNITY_SOURCE_LABELS[cat]} opportunities.`,
      libraryKind: FIT_CHECK_LIBRARY_KIND_CATEGORY,
      fitCategory: cat,
    });
  }

  if (input.rescrape !== false) {
    await clearLibraryDocuments(input.organizationId, globalLibraryId);
    for (const cat of OPPORTUNITY_SOURCE_TYPES) {
      await clearLibraryDocuments(input.organizationId, categoryLibraryIds[cat]!);
    }
  }

  const crawled = await crawlStellixSoftSite();
  const profile = stellixSoftFitCheckProfileDoc();

  const globalPayloads: DocPayload[] = [
    {
      ...profile,
      sourceRef: `${STELLIXSOFT_SITE_ORIGIN}/#profile`,
      knowledgeSection: "icp",
    },
    ...crawled.map((p) => {
      const doc = pageToKnowledgeDocument(p);
      return {
        title: doc.title,
        content: doc.content,
        sourceRef: p.url,
        knowledgeSection: sectionFromUrl(p.url),
      };
    }),
  ];

  const globalResult = await addDocuments(
    input.organizationId,
    globalLibraryId,
    input.userId,
    globalPayloads,
  );

  let totalDocs = globalResult.documentsCreated;
  let totalChunks = globalResult.chunksIndexed;
  const indexErrors = [...globalResult.indexErrors];

  for (const cat of OPPORTUNITY_SOURCE_TYPES) {
    const playbook = fitCheckCategoryPlaybook(cat);
    const catResult = await addDocuments(input.organizationId, categoryLibraryIds[cat]!, input.userId, [
      {
        title: playbook.title,
        content: playbook.content,
        sourceRef: `playbook://${cat}`,
        knowledgeSection: "playbook",
      },
    ]);
    totalDocs += catResult.documentsCreated;
    totalChunks += catResult.chunksIndexed;
    indexErrors.push(...catResult.indexErrors);
  }

  const settings = await getOrganizationAiSettingsServer(input.organizationId);
  // Preserve admin toggles (including deleted/disabled categories) while re-pointing library IDs.
  const knowledgeConfig = mergeFitCheckKnowledgeConfig(settings.fitCheckKnowledge);
  knowledgeConfig.globalLibraryId = globalLibraryId;
  for (const cat of OPPORTUNITY_SOURCE_TYPES) {
    knowledgeConfig.categories[cat] = {
      ...knowledgeConfig.categories[cat],
      libraryId: categoryLibraryIds[cat],
    };
  }
  const saveResult = await updateOrganizationAiSettingsServer(input.organizationId, {
    fitCheckKnowledge: knowledgeConfig,
    features: {
      ...settings.features,
      opportunity_fit: {
        ...settings.features.opportunity_fit,
        ragMode: settings.features.opportunity_fit.ragMode ?? "strict",
        libraryIds: undefined,
      },
      opportunity_fit_discuss: {
        ...settings.features.opportunity_fit_discuss,
        libraryIds: undefined,
      },
    },
  });

  return {
    globalLibraryId,
    categoryLibraryIds,
    documentsCreated: totalDocs,
    pagesCrawled: crawled.length,
    chunksIndexed: totalChunks,
    indexErrors,
    configSaved: !("error" in saveResult),
  };
}

export async function seedFitCheckCategoryLibraryServer(input: {
  organizationId: string;
  userId: string;
  category: OpportunitySourceType;
  rescrape?: boolean;
}): Promise<SeedFitCheckCategoryResult | { error: string }> {
  const categoryLibraryId = await ensureLibrary(input.organizationId, {
    name: `${FIT_CHECK_CATEGORY_LIBRARY_PREFIX}${OPPORTUNITY_SOURCE_LABELS[input.category]}`,
    description: `Category playbook and rules for ${OPPORTUNITY_SOURCE_LABELS[input.category]} opportunities.`,
    libraryKind: FIT_CHECK_LIBRARY_KIND_CATEGORY,
    fitCategory: input.category,
  });

  if (input.rescrape !== false) {
    await clearLibraryDocuments(input.organizationId, categoryLibraryId);
  }

  const playbook = fitCheckCategoryPlaybook(input.category);
  const catResult = await addDocuments(input.organizationId, categoryLibraryId, input.userId, [
    {
      title: playbook.title,
      content: playbook.content,
      sourceRef: `playbook://${input.category}`,
      knowledgeSection: "playbook",
    },
  ]);

  const settings = await getOrganizationAiSettingsServer(input.organizationId);
  const knowledgeConfig = mergeFitCheckKnowledgeConfig(settings.fitCheckKnowledge);
  knowledgeConfig.categories[input.category] = {
    ...knowledgeConfig.categories[input.category],
    libraryId: categoryLibraryId,
  };

  const saveResult = await updateOrganizationAiSettingsServer(input.organizationId, {
    fitCheckKnowledge: knowledgeConfig,
  });

  return {
    category: input.category,
    categoryLibraryId,
    documentsCreated: catResult.documentsCreated,
    chunksIndexed: catResult.chunksIndexed,
    indexErrors: catResult.indexErrors,
    configSaved: !("error" in saveResult),
  };
}
