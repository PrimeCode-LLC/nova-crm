import { embedFitCheckQueryServer } from "@/lib/ai/fit-check-rag";
import { getFitCheckKnowledgeConfigServer } from "@/lib/ai/fit-check-knowledge";
import { retrieveRagChunksServer, type RagChunkHit } from "@/lib/ai/rag-retrieve";
import { buildRagInstructionBlock } from "@/lib/ai/prompt-defaults";
import type { KnowledgeSection } from "@/lib/ai/fit-check-knowledge-types";
import type { AiRagMode } from "@/lib/ai/types";

/**
 * Proof-oriented sections used for outbound copy. Excludes Fit Check scoring
 * playbooks and raw website chrome, which are noise for email generation.
 */
export const OUTREACH_KNOWLEDGE_SECTIONS: KnowledgeSection[] = [
  "services",
  "case_studies",
  "icp",
];

/**
 * Shared knowledge retrieval for outbound features (follow-up sequences, email
 * reply/improve). Uses semantic + keyword hybrid retrieval, and - when the
 * feature has no explicitly configured libraries - targets the global company
 * library's proof sections instead of scanning every org library.
 *
 * Degrades gracefully: if embeddings are unavailable it falls back to keyword
 * scoring, and if no global library is resolved it uses the configured libraries
 * (or the previous scan-all behavior when those are also empty).
 */
export async function retrieveOutreachKnowledgeServer(input: {
  organizationId: string;
  query: string;
  configuredLibraryIds?: string[];
  ragMode: AiRagMode;
  scope?: { channel?: string; profileId?: string; campaignId?: string };
  topK?: number;
}): Promise<{ chunks: RagChunkHit[]; ragBlock: string }> {
  const queryEmbedding = await embedFitCheckQueryServer(input.organizationId, input.query);

  let libraryIds = input.configuredLibraryIds;
  let sections: KnowledgeSection[] | undefined;
  if (!libraryIds?.length) {
    const knowledge = await getFitCheckKnowledgeConfigServer(input.organizationId);
    if (knowledge.globalLibraryId) {
      libraryIds = [knowledge.globalLibraryId];
      sections = OUTREACH_KNOWLEDGE_SECTIONS;
    }
  }

  const chunks = await retrieveRagChunksServer({
    organizationId: input.organizationId,
    query: input.query,
    libraryIds,
    sections,
    scope: input.scope,
    topK: input.topK ?? 6,
    queryEmbedding,
  });

  const ragBlock = buildRagInstructionBlock(
    input.ragMode,
    chunks.map((c) => ({ title: c.title, content: c.content })),
  );

  return { chunks, ragBlock };
}
