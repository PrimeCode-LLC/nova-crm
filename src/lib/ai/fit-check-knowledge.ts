import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import { getOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import { retrieveRagChunksServer, type RagChunkHit } from "@/lib/ai/rag-retrieve";
import type { OrganizationAiSettings } from "@/lib/ai/types";
import type { OpportunitySourceType } from "@/lib/ai/opportunity-fit-types";
import {
  mergeFitCheckKnowledgeConfig,
  type FitCheckKnowledgeConfig,
  FIT_CHECK_LIBRARY_KIND_CATEGORY,
  FIT_CHECK_LIBRARY_KIND_GLOBAL,
  FIT_CHECK_LIBRARY_KIND_LEGACY,
} from "@/lib/ai/fit-check-knowledge-types";

export async function getFitCheckKnowledgeConfigServer(
  organizationId: string,
): Promise<FitCheckKnowledgeConfig> {
  const settings = await getOrganizationAiSettingsServer(organizationId);
  return mergeFitCheckKnowledgeConfig(settings.fitCheckKnowledge);
}

export async function resolveFitCheckLibraryIdsServer(
  organizationId: string,
  sourceType: OpportunitySourceType,
): Promise<{
  config: FitCheckKnowledgeConfig;
  globalLibraryId?: string;
  categoryLibraryId?: string;
}> {
  const config = await getFitCheckKnowledgeConfigServer(organizationId);
  const db = getAdminDb();

  let globalLibraryId = config.globalLibraryId;
  let categoryLibraryId = config.categories[sourceType]?.libraryId;

  if (db) {
    const libsSnap = await db
      .collection(COLLECTIONS.organizations)
      .doc(organizationId)
      .collection(ORG_SUBCOLLECTIONS.aiLibraries)
      .get();

    for (const doc of libsSnap.docs) {
      const data = doc.data();
      const kind = data.libraryKind as string | undefined;
      const fitCategory = data.fitCategory as OpportunitySourceType | undefined;

      if (
        !globalLibraryId &&
        (kind === FIT_CHECK_LIBRARY_KIND_GLOBAL || kind === FIT_CHECK_LIBRARY_KIND_LEGACY)
      ) {
        globalLibraryId = doc.id;
      }
      if (
        !categoryLibraryId &&
        kind === FIT_CHECK_LIBRARY_KIND_CATEGORY &&
        fitCategory === sourceType
      ) {
        categoryLibraryId = doc.id;
      }
    }
  }

  return { config, globalLibraryId, categoryLibraryId };
}

/**
 * Cost-efficient retrieval: one query, capped chunks per layer (no duplicate website embeddings).
 */
export async function retrieveFitCheckRagChunksServer(input: {
  organizationId: string;
  query: string;
  sourceType: OpportunitySourceType;
}): Promise<RagChunkHit[]> {
  const { config, globalLibraryId, categoryLibraryId } =
    await resolveFitCheckLibraryIdsServer(input.organizationId, input.sourceType);

  const catCfg = config.categories[input.sourceType];
  const budget = config.retrievalBudget;
  const hits: RagChunkHit[] = [];

  const useGlobal =
    config.globalEnabled &&
    catCfg?.useGlobal !== false &&
    globalLibraryId &&
    budget.globalChunks > 0;

  if (useGlobal) {
    const globalHits = await retrieveRagChunksServer({
      organizationId: input.organizationId,
      query: input.query,
      libraryIds: [globalLibraryId],
      topK: budget.globalChunks,
    });
    hits.push(...globalHits);
  }

  const useCategory =
    catCfg?.enabled !== false &&
    categoryLibraryId &&
    budget.categoryChunks > 0;

  if (useCategory) {
    const catHits = await retrieveRagChunksServer({
      organizationId: input.organizationId,
      query: input.query,
      libraryIds: [categoryLibraryId],
      topK: budget.categoryChunks,
    });
    hits.push(...catHits);
  }

  // Fallback: legacy feature.libraryIds if layered config empty
  if (hits.length === 0) {
    const settings = await getOrganizationAiSettingsServer(input.organizationId);
    const legacyIds = settings.features.opportunity_fit.libraryIds;
    if (legacyIds?.length) {
      return retrieveRagChunksServer({
        organizationId: input.organizationId,
        query: input.query,
        libraryIds: legacyIds,
        topK: budget.globalChunks + budget.categoryChunks,
      });
    }
  }

  const seen = new Set<string>();
  return hits
    .sort((a, b) => b.score - a.score)
    .filter((h) => {
      const key = `${h.documentId}:${h.content.slice(0, 80)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, budget.globalChunks + budget.categoryChunks);
}

export function attachFitCheckKnowledgeToSettings(
  settings: OrganizationAiSettings,
  patch: Partial<FitCheckKnowledgeConfig>,
): OrganizationAiSettings {
  return {
    ...settings,
    fitCheckKnowledge: mergeFitCheckKnowledgeConfig({
      ...settings.fitCheckKnowledge,
      ...patch,
      categories: patch.categories
        ? {
            ...mergeFitCheckKnowledgeConfig(settings.fitCheckKnowledge).categories,
            ...patch.categories,
          }
        : settings.fitCheckKnowledge?.categories,
    }),
  };
}
