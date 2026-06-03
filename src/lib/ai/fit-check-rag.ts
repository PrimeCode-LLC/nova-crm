import { createOpenAI } from "@ai-sdk/openai";
import { embed } from "ai";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import { getAiProviderKeyServer } from "@/lib/ai/ai-secrets-server";
import { getOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import {
  resolveFitCheckLibraryIdsServer,
} from "@/lib/ai/fit-check-knowledge";
import { retrieveRagChunksServer, type RagChunkHit } from "@/lib/ai/rag-retrieve";
import type { OpportunitySourceType } from "@/lib/ai/opportunity-fit-types";
import type { KnowledgeSection } from "@/lib/ai/fit-check-knowledge-types";
import type { AiLibraryScope } from "@/lib/ai/types";

/** Chars per chunk in the LLM prompt — keeps quality while limiting tokens. */
export const FIT_CHECK_CHUNK_PROMPT_CHARS = 900;
/** Pinned ICP/stack docs are smaller but always included. */
export const FIT_CHECK_PINNED_PROMPT_CHARS = 650;
/** Internal pool before MMR-style dedupe and cap. */
const RETRIEVE_POOL_MULTIPLIER = 2;

const PINNED_SECTIONS: KnowledgeSection[] = ["icp", "services", "other"];

export type FitCheckRagBundle = {
  chunks: RagChunkHit[];
  ragBlock: string;
  corpusText: string;
};

function truncateForPrompt(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function dedupeChunks(hits: RagChunkHit[]): RagChunkHit[] {
  const seen = new Set<string>();
  const out: RagChunkHit[] = [];
  for (const h of hits.sort((a, b) => b.score - a.score)) {
    const key = `${h.documentId}:${h.content.slice(0, 96)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

export async function embedFitCheckQueryServer(
  organizationId: string,
  query: string,
): Promise<number[] | undefined> {
  const settings = await getOrganizationAiSettingsServer(organizationId);
  const provider = settings.embeddingProvider ?? "openai";
  if (provider !== "openai") return undefined;

  const apiKey = await getAiProviderKeyServer(organizationId, provider);
  if (!apiKey) return undefined;

  const model = settings.embeddingModel ?? "text-embedding-3-small";
  try {
    const openai = createOpenAI({ apiKey });
    const { embedding } = await embed({
      model: openai.embedding(model),
      value: query.slice(0, 8000),
    });
    return embedding;
  } catch {
    return undefined;
  }
}

async function findProfileLibraryIdsServer(
  organizationId: string,
  profileId: string,
): Promise<string[]> {
  const db = getAdminDb();
  if (!db) return [];

  const snap = await db
    .collection(COLLECTIONS.organizations)
    .doc(organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiLibraries)
    .get();

  return snap.docs
    .filter((d) => {
      const scope = d.data().scope as AiLibraryScope | undefined;
      return scope?.type === "profile" && scope.profileId === profileId;
    })
    .map((d) => d.id);
}

async function fetchPinnedChunksServer(input: {
  organizationId: string;
  libraryIds: string[];
  maxChunks: number;
}): Promise<RagChunkHit[]> {
  const db = getAdminDb();
  if (!db || input.libraryIds.length === 0) return [];

  const hits: RagChunkHit[] = [];
  const docsCol = db
    .collection(COLLECTIONS.organizations)
    .doc(input.organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiDocuments);

  for (const libraryId of input.libraryIds) {
    if (hits.length >= input.maxChunks) break;
    const snap = await docsCol.where("libraryId", "==", libraryId).limit(40).get();
    const pinnedDocs = snap.docs
      .map((d) => ({ id: d.id, data: d.data() }))
      .filter((d) => {
        const section = d.data.knowledgeSection as KnowledgeSection | undefined;
        return section && PINNED_SECTIONS.includes(section);
      })
      .sort((a, b) => {
        const rank = (s: KnowledgeSection | undefined) =>
          s === "services" ? 0 : s === "icp" ? 1 : 2;
        return rank(a.data.knowledgeSection as KnowledgeSection) - rank(b.data.knowledgeSection as KnowledgeSection);
      });

    for (const doc of pinnedDocs) {
      if (hits.length >= input.maxChunks) break;
      const chunksSnap = await docsCol.doc(doc.id).collection("chunks").limit(1).get();
      const content =
        chunksSnap.docs[0]?.data().content ??
        String(doc.data.content ?? "").slice(0, FIT_CHECK_PINNED_PROMPT_CHARS);
      hits.push({
        title: String(doc.data.title ?? "Company profile"),
        content: truncateForPrompt(String(content), FIT_CHECK_PINNED_PROMPT_CHARS),
        score: 1,
        libraryId,
        documentId: doc.id,
      });
    }
  }

  return hits;
}

async function resolvePrimaryLibraryIdsServer(input: {
  organizationId: string;
  sourceType: OpportunitySourceType;
  profileId?: string;
}): Promise<{
  primaryLibraryIds: string[];
  categoryLibraryId?: string;
  globalLibraryId?: string;
  useGlobal: boolean;
  useCategory: boolean;
  budget: { globalChunks: number; categoryChunks: number };
}> {
  const { config, globalLibraryId, categoryLibraryId } =
    await resolveFitCheckLibraryIdsServer(input.organizationId, input.sourceType);

  const catCfg = config.categories[input.sourceType];
  const budget = config.retrievalBudget;

  const profileLibs = input.profileId
    ? await findProfileLibraryIdsServer(input.organizationId, input.profileId)
    : [];

  const useGlobal =
    profileLibs.length === 0 &&
    config.globalEnabled &&
    catCfg?.useGlobal !== false &&
    !!globalLibraryId;

  const primaryLibraryIds =
    profileLibs.length > 0 ? profileLibs : useGlobal && globalLibraryId ? [globalLibraryId] : [];

  const useCategory =
    catCfg?.enabled !== false && !!categoryLibraryId && budget.categoryChunks > 0;

  return {
    primaryLibraryIds,
    categoryLibraryId,
    globalLibraryId,
    useGlobal,
    useCategory,
    budget,
  };
}

/**
 * Professional-style Fit Check RAG: pinned ICP/stack + hybrid retrieval + compact prompt block.
 */
export async function retrieveFitCheckContextServer(input: {
  organizationId: string;
  query: string;
  sourceType: OpportunitySourceType;
  profileId?: string;
}): Promise<FitCheckRagBundle> {
  const { primaryLibraryIds, categoryLibraryId, useCategory, budget } =
    await resolvePrimaryLibraryIdsServer(input);

  const queryEmbedding = await embedFitCheckQueryServer(input.organizationId, input.query);

  const pinned = await fetchPinnedChunksServer({
    organizationId: input.organizationId,
    libraryIds: primaryLibraryIds,
    maxChunks: 2,
  });

  const poolK = Math.max(
    4,
    (budget.globalChunks + budget.categoryChunks) * RETRIEVE_POOL_MULTIPLIER,
  );

  let semanticHits: RagChunkHit[] = [];

  if (primaryLibraryIds.length > 0) {
    semanticHits = await retrieveRagChunksServer({
      organizationId: input.organizationId,
      query: input.query,
      libraryIds: primaryLibraryIds,
      topK: poolK,
      queryEmbedding,
    });
  }

  if (useCategory && categoryLibraryId) {
    const catHits = await retrieveRagChunksServer({
      organizationId: input.organizationId,
      query: input.query,
      libraryIds: [categoryLibraryId],
      topK: Math.max(4, budget.categoryChunks * RETRIEVE_POOL_MULTIPLIER),
      queryEmbedding,
    });
    semanticHits.push(...catHits);
  }

  if (semanticHits.length === 0 && primaryLibraryIds.length === 0) {
    const settings = await getOrganizationAiSettingsServer(input.organizationId);
    const legacyIds = settings.features.opportunity_fit.libraryIds;
    if (legacyIds?.length) {
      semanticHits = await retrieveRagChunksServer({
        organizationId: input.organizationId,
        query: input.query,
        libraryIds: legacyIds,
        topK: poolK,
        queryEmbedding,
      });
    }
  }

  const pinnedDocIds = new Set(pinned.map((p) => p.documentId));

  const merged = dedupeChunks([
    ...pinned.map((p) => ({ ...p, score: 2 })),
    ...semanticHits.filter((h) => !pinnedDocIds.has(h.documentId)),
  ]);

  const maxTotal = Math.min(9, budget.globalChunks + budget.categoryChunks + pinned.length);
  const chunks = merged.slice(0, maxTotal).map((c) => ({
    ...c,
    content: truncateForPrompt(
      c.content,
      pinnedDocIds.has(c.documentId) ? FIT_CHECK_PINNED_PROMPT_CHARS : FIT_CHECK_CHUNK_PROMPT_CHARS,
    ),
  }));

  const ragBlock = buildFitCheckRagBlock(chunks, {
    profileId: input.profileId,
  });
  const corpusText = chunks.map((c) => `${c.title}\n${c.content}`).join("\n\n");

  return { chunks, ragBlock, corpusText };
}

export function buildFitCheckRagBlock(
  chunks: { title: string; content: string }[],
  meta?: { profileId?: string },
): string {
  if (chunks.length === 0) return "";

  const profileNote = meta?.profileId
    ? `Profile-scoped knowledge (persona ${meta.profileId}). `
    : "";

  const corpus = chunks
    .map((c, i) => `[${i + 1}] ${c.title}\n${c.content}`)
    .join("\n\n");

  return `${profileNote}Knowledge base (strict — use only this for company capabilities, ICP, and scoring rules):
Rules for gaps:
- List gaps about the OPPORTUNITY (missing info, stack mismatch vs what we deliver, budget, geo). Use gapKind "opportunity" or "commercial".
- Never claim our company lacks a technology that appears in these excerpts. gapKind "company_capability" only when the opportunity requires something we truly do not offer per excerpts.
- "blocker" only for company_capability or clear ICP violation — not because the job post omits a keyword we support.

${corpus}`;
}
