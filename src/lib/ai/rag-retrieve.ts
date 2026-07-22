import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import type { AiLibraryScope } from "@/lib/ai/types";

export type RagChunkHit = {
  title: string;
  content: string;
  score: number;
  libraryId: string;
  documentId: string;
};

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
  filter: { channel?: string; profileId?: string; campaignId?: string },
): boolean {
  if (scope.type === "org") return true;
  if (scope.type === "channel" && filter.channel) return scope.channelKey === filter.channel;
  if (scope.type === "profile" && filter.profileId) return scope.profileId === filter.profileId;
  if (scope.type === "campaign" && filter.campaignId) return scope.campaignId === filter.campaignId;
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
  scope?: { channel?: string; profileId?: string; campaignId?: string };
  topK?: number;
  queryEmbedding?: number[];
}): Promise<RagChunkHit[]> {
  const db = getAdminDb();
  if (!db) return [];

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
      if (sections) {
        const section = docSnap.data().knowledgeSection as string | undefined;
        if (section && !sections.has(section)) continue;
      }
      const chunksSnap = await docSnap.ref.collection("chunks").limit(200).get();
      for (const chunkSnap of chunksSnap.docs) {
        const data = chunkSnap.data();
        const content = String(data.content ?? "");
        const title = String(data.title ?? docSnap.data().title ?? "chunk");
        const embedding = data.embedding as number[] | undefined;
        const kw = ragKeywordScore(input.query, content);
        let score = kw;
        if (input.queryEmbedding?.length && embedding?.length) {
          score = ragHybridScore(
            cosineSimilarity(input.queryEmbedding, embedding),
            kw,
          );
        }
        hits.push({
          title,
          content,
          score,
          libraryId: libDoc.id,
          documentId: docSnap.id,
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
      const embedding = data.embedding as number[] | undefined;
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
