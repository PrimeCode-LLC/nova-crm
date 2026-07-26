import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import { embedFitCheckQueryServer } from "@/lib/ai/fit-check-rag";
import { retrieveRagChunksServer, type RagChunkHit } from "@/lib/ai/rag-retrieve";
import { buildRagInstructionBlock } from "@/lib/ai/prompt-defaults";
import { getFitCheckKnowledgeConfigServer } from "@/lib/ai/fit-check-knowledge";
import type { KnowledgeSection } from "@/lib/ai/fit-check-knowledge-types";
import type { AiRagMode } from "@/lib/ai/types";
import {
  CONTENT_BRAND_KIND_LABELS,
  CONTENT_OUTCOME_LABELS,
  CONTENT_STRATEGY_LABELS,
  type ContentBrand,
} from "@/lib/content-calendar/types";

/** Proof + voice sections used for content generation. */
export const CONTENT_KNOWLEDGE_SECTIONS: KnowledgeSection[] = [
  "case_studies",
  "services",
  "icp",
  "content_voice",
];

export async function getContentBrandServer(
  organizationId: string,
  brandId: string,
): Promise<ContentBrand | null> {
  const db = getAdminDb();
  if (!db) return null;
  const snap = await db.collection(COLLECTIONS.contentBrands).doc(brandId).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  if (data.organizationId !== organizationId) return null;
  const { mapContentBrand } = await import("@/lib/content-calendar/map-docs");
  return mapContentBrand(snap.id, data as Record<string, unknown>);
}

/**
 * Ensure a brand-scoped knowledge library exists (for captures / voice docs).
 */
export async function ensureContentBrandLibraryServer(input: {
  organizationId: string;
  brandId: string;
  brandName: string;
}): Promise<string> {
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured");

  const libs = db
    .collection(COLLECTIONS.organizations)
    .doc(input.organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiLibraries);

  const existing = await libs
    .where("libraryKind", "==", "content_brand")
    .limit(25)
    .get();

  for (const doc of existing.docs) {
    const scope = doc.data().scope as { type?: string; brandId?: string } | undefined;
    if (scope?.type === "content_brand" && scope.brandId === input.brandId) {
      return doc.id;
    }
  }

  const now = new Date().toISOString();
  const ref = libs.doc();
  await ref.set({
    organizationId: input.organizationId,
    name: `Content · ${input.brandName}`,
    description: "Case studies and voice docs for content calendar",
    scope: { type: "content_brand", brandId: input.brandId },
    libraryKind: "content_brand",
    allowedFeatures: ["content"],
    documentCount: 0,
    chunkCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export async function retrieveContentKnowledgeServer(input: {
  organizationId: string;
  brand: ContentBrand;
  query: string;
  ragMode: AiRagMode;
  publicSafeOnly?: boolean;
  topK?: number;
}): Promise<{ chunks: RagChunkHit[]; ragBlock: string }> {
  const queryEmbedding = await embedFitCheckQueryServer(input.organizationId, input.query);

  let libraryIds = input.brand.knowledgeLibraryIds?.filter(Boolean);
  if (!libraryIds?.length) {
    const knowledge = await getFitCheckKnowledgeConfigServer(input.organizationId);
    if (knowledge.globalLibraryId) {
      libraryIds = [knowledge.globalLibraryId];
    }
  }

  const chunks = await retrieveRagChunksServer({
    organizationId: input.organizationId,
    query: input.query,
    libraryIds,
    sections: CONTENT_KNOWLEDGE_SECTIONS,
    scope: { brandId: input.brand.id },
    topK: input.topK ?? 6,
    queryEmbedding,
  });

  // publicSafeOnly: prefer case_studies/services; content_voice always ok
  const filtered =
    input.publicSafeOnly === false
      ? chunks
      : chunks.filter((c) => {
          // Heuristic: skip chunks that look internal-only when we lack metadata
          const lower = c.content.toLowerCase();
          if (lower.includes("internal only") || lower.includes("not for public")) return false;
          return true;
        });

  const ragBlock = buildRagInstructionBlock(
    input.ragMode,
    filtered.map((c) => ({ title: c.title, content: c.content })),
  );

  return { chunks: filtered, ragBlock };
}

export function formatBrandContextForPrompt(brand: ContentBrand): string {
  const pillars = brand.pillars
    .filter((p) => p.enabled)
    .map((p) => `${p.key} (${p.name}): ${p.targetPercent}%`)
    .join("; ");
  return [
    `Name: ${brand.name}`,
    `Brand type: ${CONTENT_BRAND_KIND_LABELS[brand.kind] ?? brand.kind}`,
    `Primary outcome: ${CONTENT_OUTCOME_LABELS[brand.primaryOutcome] ?? brand.primaryOutcome}`,
    `Content strategy: ${CONTENT_STRATEGY_LABELS[brand.contentStrategy] ?? brand.contentStrategy}`,
    `Target audience: ${brand.targetAudience || "not set"}`,
    `Offers to promote: ${brand.offersToPromote || "not set"}`,
    `Proof sources: ${brand.proofSources || "not set"}`,
    `Preferred CTAs: ${brand.preferredCtas || brand.defaultCtaType}`,
    `Topics to avoid: ${brand.topicsToAvoid.join(", ") || "none"}`,
    `Reference creators: ${brand.referenceCreators || "none"}`,
    `Default formats: ${brand.defaultFormats.join(", ") || "text_post"}`,
    `Approval required: ${brand.approvalRequired ? "yes" : "no"}`,
    `Platforms: ${brand.platforms.join(", ")}`,
    `Positioning: ${brand.positioning}`,
    `Voice: ${brand.voiceRules}`,
    `Banned phrases: ${brand.bannedPhrases.join(", ") || "none"}`,
    `Default CTA: ${brand.defaultCtaType}`,
    `Pillars: ${pillars}`,
    brand.promptOverrides?.extraSystemInstructions
      ? `Extra instructions: ${brand.promptOverrides.extraSystemInstructions}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
