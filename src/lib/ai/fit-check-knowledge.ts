import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import { getOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import { retrieveFitCheckContextServer } from "@/lib/ai/fit-check-rag";
import type { RagChunkHit } from "@/lib/ai/rag-retrieve";
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

/** @deprecated Prefer retrieveFitCheckContextServer for analyze (includes compact ragBlock). */
export async function retrieveFitCheckRagChunksServer(input: {
  organizationId: string;
  query: string;
  sourceType: OpportunitySourceType;
  profileId?: string;
}): Promise<RagChunkHit[]> {
  const bundle = await retrieveFitCheckContextServer(input);
  return bundle.chunks;
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
