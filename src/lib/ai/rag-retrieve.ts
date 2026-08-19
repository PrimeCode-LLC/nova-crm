import { FieldValue } from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import type { AiLibraryScope } from "@/lib/ai/types";

export type RagChunkHit = {
  title: string;
  content: string;
  score: number;
  libraryId: string;
  documentId: string;
  /** Present when denormalized on the chunk or copied from the parent document. */
  knowledgeSection?: string;
};

/**
 * Reads a stored embedding whether it was written as a native Firestore vector
 * (VectorValue with `.toArray()`) or as a legacy plain number[] array.
 */
function embeddingToArray(value: unknown): number[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value as number[];
  const maybe = value as { toArray?: () => number[] };
  if (typeof maybe.toArray === "function") return maybe.toArray();
  return undefined;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function libraryMatchesScope(
  scope: AiLibraryScope,
  filter: { channel?: string; profileId?: string; campaignId?: string; brandId?: string },
): boolean {
  if (scope.type === "org") return true;
  if (scope.type === "channel" && filter.channel) return scope.channelKey === filter.channel;
  if (scope.type === "profile" && filter.profileId) return scope.profileId === filter.profileId;
  if (scope.type === "campaign" && filter.campaignId) return scope.campaignId === filter.campaignId;
  if (scope.type === "content_brand" && filter.brandId) return scope.brandId === filter.brandId;
  return false;
}

/** Keyword overlap score 0–1 for hybrid RAG. */
export function ragKeywordScore(query: string, text: string): number {
  const q = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const t = text.toLowerCase();
  if (q.length === 0) return 0;
  let hits = 0;
  for (const w of q) {
    if (t.includes(w)) hits++;
  }
  return hits / q.length;
}

/** Blend semantic + keyword scores (common enterprise RAG pattern). */
export function ragHybridScore(semantic: number, keyword: number): number {
  return 0.72 * semantic + 0.28 * keyword;
}

/**
 * KNN retrieval via Firestore native vector search (`findNearest`) over the
 * `chunks` collection group. Pre-filters by organization (always) and by a
 * single library when exactly one is requested; library/section allow-lists are
 * post-filtered on the returned neighbours.
 *
 * Returns `null` (never throws) when vector search is unavailable - the vector
 * index has not been deployed yet, or the chunks have not been re-indexed to
 * native vectors. Callers should fall back to the in-app cosine scan.
 */
async function retrieveRagChunksByVectorSearch(input: {
  organizationId: string;
  libraryIds?: string[];
  sections?: string[];
  topK?: number;
  queryEmbedding: number[];
}): Promise<RagChunkHit[] | null> {
  const db = getAdminDb();
  if (!db) return null;

  try {
    let query = db
      .collectionGroup("chunks")
      .where("organizationId", "==", input.organizationId);

    // Equality pre-filter is only valid for a single library; multiple libraries
    // are handled by the post-filter below.
    if (input.libraryIds && input.libraryIds.length === 1) {
      query = query.where("libraryId", "==", input.libraryIds[0]);
    }

    const topK = input.topK ?? 6;
    // Over-fetch so library/section post-filtering still leaves enough neighbours.
    const limit = Math.max(topK * 4, 16);

    const snap = await query
      .findNearest({
        vectorField: "embedding",
        queryVector: FieldValue.vector(input.queryEmbedding),
        limit,
        distanceMeasure: "COSINE",
        distanceResultField: "__vectorDistance",
      })
      .get();

    // Empty result usually means the chunks are still legacy arrays (not native
    // vectors); fall back to the cosine scan so retrieval keeps working.
    if (snap.empty) return null;

    const librarySet =
      input.libraryIds && input.libraryIds.length > 0 ? new Set(input.libraryIds) : null;
    const sectionSet =
      input.sections && input.sections.length > 0 ? new Set(input.sections) : null;

    const hits: RagChunkHit[] = [];
    for (const chunkSnap of snap.docs) {
      const data = chunkSnap.data();
      const libraryId = String(data.libraryId ?? "");
      if (librarySet && !librarySet.has(libraryId)) continue;
      if (sectionSet) {
        const section = data.knowledgeSection as string | null | undefined;
        if (section && !sectionSet.has(section)) continue;
      }
      const distance = Number(data.__vectorDistance ?? 1);
      const documentId = chunkSnap.ref.parent.parent?.id ?? "";
      const knowledgeSection =
        typeof data.knowledgeSection === "string" ? data.knowledgeSection : undefined;
      hits.push({
        title: String(data.title ?? "chunk"),
        content: String(data.content ?? ""),
        // COSINE distance in [0,2]; map to a [0,1] similarity for ranking parity.
        score: 1 - distance,
        libraryId,
        documentId,
        knowledgeSection,
      });
    }

    if (hits.length === 0) return null;
    return hits.sort((a, b) => b.score - a.score).slice(0, topK);
  } catch {
    // Missing/not-yet-built vector index, or an SDK signature mismatch: let the
    // caller fall back to the in-app cosine scan rather than failing the request.
    return null;
  }
}

export async function retrieveRagChunksServer(input: {
  organizationId: string;
  query: string;
  libraryIds?: string[];
  /**
   * Optional `knowledgeSection` allow-list. Documents whose section is set and not
   * in this list are skipped (documents without a section always pass through, so
   * non-Fit-Check libraries are unaffected).
   */
  sections?: string[];
  scope?: { channel?: string; profileId?: string; campaignId?: string; brandId?: string };
  topK?: number;
  queryEmbedding?: number[];
}): Promise<RagChunkHit[]> {
  const db = getAdminDb();
  if (!db) return [];

  // Prefer Firestore native vector search when we have a query embedding and an
  // explicit library target. It pushes KNN ranking into the database instead of
  // scanning every chunk in process. We require explicit libraryIds so the
  // library `scope` matching in the cosine scan below is never silently bypassed
  // (scope-only library selection still uses the scan). Returns null (and we
  // fall through to the cosine scan) whenever the vector index or native-vector
  // chunks are not yet available.
  if (input.queryEmbedding?.length && input.libraryIds?.length) {
    const vectorHits = await retrieveRagChunksByVectorSearch({
      organizationId: input.organizationId,
      libraryIds: input.libraryIds,
      sections: input.sections,
      topK: input.topK,
      queryEmbedding: input.queryEmbedding,
    });
    if (vectorHits) return vectorHits;
  }

  const libsSnap = await db
    .collection(COLLECTIONS.organizations)
    .doc(input.organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiLibraries)
    .get();

  const libraryIds = new Set(input.libraryIds ?? []);
  const sections = input.sections && input.sections.length > 0 ? new Set(input.sections) : null;
  const hits: RagChunkHit[] = [];

  for (const libDoc of libsSnap.docs) {
    if (libraryIds.size > 0 && !libraryIds.has(libDoc.id)) continue;
    const scope = libDoc.data().scope as AiLibraryScope | undefined;
    if (scope && input.scope && !libraryMatchesScope(scope, input.scope)) {
      if (scope.type !== "org") continue;
    }

    const docsSnap = await db
      .collection(COLLECTIONS.organizations)
      .doc(input.organizationId)
      .collection(ORG_SUBCOLLECTIONS.aiDocuments)
      .where("libraryId", "==", libDoc.id)
      .limit(50)
      .get();

    for (const docSnap of docsSnap.docs) {
      const docSection = docSnap.data().knowledgeSection as string | undefined;
      if (sections) {
        if (docSection && !sections.has(docSection)) continue;
      }
      const chunksSnap = await docSnap.ref.collection("chunks").limit(200).get();
      for (const chunkSnap of chunksSnap.docs) {
        const data = chunkSnap.data();
        const content = String(data.content ?? "");
        const title = String(data.title ?? docSnap.data().title ?? "chunk");
        const embedding = embeddingToArray(data.embedding);
        const kw = ragKeywordScore(input.query, content);
        let score = kw;
        if (input.queryEmbedding?.length && embedding?.length) {
          score = ragHybridScore(
            cosineSimilarity(input.queryEmbedding, embedding),
            kw,
          );
        }
        const chunkSection =
          typeof data.knowledgeSection === "string" ? data.knowledgeSection : docSection;
        hits.push({
          title,
          content,
          score,
          libraryId: libDoc.id,
          documentId: docSnap.id,
          knowledgeSection: chunkSection,
        });
      }
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, input.topK ?? 6);
}

/** Retrieve chunks only from specific documents (profile-linked playbooks). */
export async function retrieveRagChunksForDocumentsServer(input: {
  organizationId: string;
  query: string;
  documentIds: string[];
  topK?: number;
  queryEmbedding?: number[];
}): Promise<RagChunkHit[]> {
  const db = getAdminDb();
  if (!db || input.documentIds.length === 0) return [];

  const hits: RagChunkHit[] = [];
  const docsCol = db
    .collection(COLLECTIONS.organizations)
    .doc(input.organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiDocuments);

  for (const documentId of input.documentIds) {
    const docSnap = await docsCol.doc(documentId).get();
    if (!docSnap.exists) continue;
    const libraryId = String(docSnap.data()?.libraryId ?? "");
    const chunksSnap = await docSnap.ref.collection("chunks").limit(200).get();
    for (const chunkSnap of chunksSnap.docs) {
      const data = chunkSnap.data();
      const content = String(data.content ?? "");
      const title = String(data.title ?? docSnap.data()?.title ?? "chunk");
      const embedding = embeddingToArray(data.embedding);
      const kw = ragKeywordScore(input.query, content);
      let score = kw;
      if (input.queryEmbedding?.length && embedding?.length) {
        score = ragHybridScore(cosineSimilarity(input.queryEmbedding, embedding), kw);
      }
      hits.push({
        title,
        content,
        score,
        libraryId,
        documentId,
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, input.topK ?? 6);
}
