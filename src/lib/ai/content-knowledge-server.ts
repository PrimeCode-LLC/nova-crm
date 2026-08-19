import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
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

/** Proof + voice sections used for public-safe content generation. */
export const CONTENT_KNOWLEDGE_SECTIONS: KnowledgeSection[] = [
  "case_studies",
  "services",
  "icp",
  "content_voice",
];

/**
 * Same as {@link CONTENT_KNOWLEDGE_SECTIONS} plus Capture `other` (non-public) docs
 * so brand-linked libraries with internal captures still contribute to generation.
 */
export const CONTENT_KNOWLEDGE_SECTIONS_WITH_INTERNAL: KnowledgeSection[] = [
  ...CONTENT_KNOWLEDGE_SECTIONS,
  "other",
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
    description: `Brand pack for ${input.brandName}: case studies, voice, and proof used by the content calendar.`,
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

function filterPublicSafeChunks(chunks: RagChunkHit[], publicSafeOnly: boolean): RagChunkHit[] {
  if (!publicSafeOnly) return chunks;
  return chunks.filter((c) => {
    const lower = c.content.toLowerCase();
    if (lower.includes("internal only") || lower.includes("not for public")) return false;
    return true;
  });
}

/** Label internal Capture chunks so the model uses them for angle, not as public proof. */
export function formatContentRagChunkForPrompt(
  chunk: RagChunkHit,
  publicSafeOnly: boolean,
): { title: string; content: string } {
  if (publicSafeOnly && chunk.knowledgeSection === "other") {
    return {
      title: `${chunk.title} (internal context — do not quote as public proof)`,
      content: chunk.content,
    };
  }
  return { title: chunk.title, content: chunk.content };
}

export type ContentKnowledgeLibraryIntro = {
  id: string;
  name: string;
  description?: string;
};

/** Orientation block: what each linked knowledge pack is for (not proof). */
export function formatKnowledgeLibrariesForPrompt(
  libraries: ContentKnowledgeLibraryIntro[],
): string {
  if (libraries.length === 0) {
    return "No knowledge packs linked.";
  }
  return libraries
    .map((lib) => {
      const intro = lib.description?.trim();
      return intro
        ? `- ${lib.name}: ${intro}`
        : `- ${lib.name}: (no intro set — treat as a generic knowledge pack)`;
    })
    .join("\n");
}

/**
 * Resolve which libraries a content brand (or capture target) should orient against.
 * Prefer explicit ids, then brand links, then company global.
 */
export async function resolveContentKnowledgeLibraryIdsServer(input: {
  organizationId: string;
  brand?: ContentBrand | null;
  libraryIds?: string[];
}): Promise<string[]> {
  const explicit = input.libraryIds?.map((id) => id.trim()).filter(Boolean) ?? [];
  if (explicit.length > 0) return [...new Set(explicit)];

  const brandIds = input.brand?.knowledgeLibraryIds?.filter(Boolean) ?? [];
  if (brandIds.length > 0) return [...new Set(brandIds)];

  const knowledge = await getFitCheckKnowledgeConfigServer(input.organizationId);
  return knowledge.globalLibraryId ? [knowledge.globalLibraryId] : [];
}

export async function getContentKnowledgeLibraryIntrosServer(input: {
  organizationId: string;
  brand?: ContentBrand | null;
  libraryIds?: string[];
}): Promise<ContentKnowledgeLibraryIntro[]> {
  const db = getAdminDb();
  if (!db) return [];

  const libraryIds = await resolveContentKnowledgeLibraryIdsServer(input);
  if (libraryIds.length === 0) return [];

  const libsCol = db
    .collection(COLLECTIONS.organizations)
    .doc(input.organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiLibraries);

  const snaps = await Promise.all(libraryIds.map((id) => libsCol.doc(id).get()));
  const out: ContentKnowledgeLibraryIntro[] = [];
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const data = snap.data() ?? {};
    const name =
      typeof data.name === "string" && data.name.trim() ? data.name.trim() : snap.id;
    const description =
      typeof data.description === "string" && data.description.trim()
        ? data.description.trim()
        : undefined;
    out.push({ id: snap.id, name, description });
  }
  return out;
}

export async function getContentKnowledgePackContextServer(input: {
  organizationId: string;
  brand?: ContentBrand | null;
  libraryIds?: string[];
}): Promise<string> {
  const intros = await getContentKnowledgeLibraryIntrosServer(input);
  return formatKnowledgeLibrariesForPrompt(intros);
}

export async function retrieveContentKnowledgeServer(input: {
  organizationId: string;
  brand: ContentBrand;
  query: string;
  ragMode: AiRagMode;
  publicSafeOnly?: boolean;
  topK?: number;
}): Promise<{
  chunks: RagChunkHit[];
  ragBlock: string;
  knowledgePackContext: string;
}> {
  const queryEmbedding = await embedFitCheckQueryServer(input.organizationId, input.query);
  const topK = input.topK ?? 6;
  const publicSafeOnly = input.publicSafeOnly !== false;
  const sections = CONTENT_KNOWLEDGE_SECTIONS_WITH_INTERNAL;

  const brandLibraryIds = input.brand.knowledgeLibraryIds?.filter(Boolean) ?? [];
  const knowledge = await getFitCheckKnowledgeConfigServer(input.organizationId);
  const companyLibraryId = knowledge.globalLibraryId;

  let libraryIds = brandLibraryIds.length
    ? brandLibraryIds
    : companyLibraryId
      ? [companyLibraryId]
      : undefined;

  const [chunks, knowledgePackContext] = await Promise.all([
    retrieveRagChunksServer({
      organizationId: input.organizationId,
      query: input.query,
      libraryIds,
      sections,
      scope: { brandId: input.brand.id },
      topK,
      queryEmbedding,
    }),
    getContentKnowledgePackContextServer({
      organizationId: input.organizationId,
      brand: input.brand,
      libraryIds,
    }),
  ]);

  let workingChunks = chunks;
  let filtered = filterPublicSafeChunks(workingChunks, publicSafeOnly);

  // Explicit brand links replace Company — but empty/unindexed Topic libs should not
  // starve drafts. Fall back to Company when brand libs yield nothing usable.
  if (
    filtered.length === 0 &&
    brandLibraryIds.length > 0 &&
    companyLibraryId &&
    !brandLibraryIds.includes(companyLibraryId)
  ) {
    workingChunks = await retrieveRagChunksServer({
      organizationId: input.organizationId,
      query: input.query,
      libraryIds: [companyLibraryId],
      sections,
      scope: { brandId: input.brand.id },
      topK,
      queryEmbedding,
    });
    filtered = filterPublicSafeChunks(workingChunks, publicSafeOnly);
  }

  const ragBlock = buildRagInstructionBlock(
    input.ragMode,
    filtered.map((c) => formatContentRagChunkForPrompt(c, publicSafeOnly)),
  );

  return { chunks: filtered, ragBlock, knowledgePackContext };
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
