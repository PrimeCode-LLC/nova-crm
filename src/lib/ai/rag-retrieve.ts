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

/** Keyword fallback when embeddings unavailable. */
function keywordScore(query: string, text: string): number {
  const q = query.toLowerCase().split(/\s+/).filter(Boolean);
  const t = text.toLowerCase();
  let hits = 0;
  for (const w of q) {
    if (w.length > 2 && t.includes(w)) hits++;
  }
  return hits / Math.max(1, q.length);
}

export async function retrieveRagChunksServer(input: {
  organizationId: string;
  query: string;
  libraryIds?: string[];
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
      const chunksSnap = await docSnap.ref.collection("chunks").limit(200).get();
      for (const chunkSnap of chunksSnap.docs) {
        const data = chunkSnap.data();
        const content = String(data.content ?? "");
        const title = String(data.title ?? docSnap.data().title ?? "chunk");
        const embedding = data.embedding as number[] | undefined;
        let score = keywordScore(input.query, content);
        if (input.queryEmbedding?.length && embedding?.length) {
          score = cosineSimilarity(input.queryEmbedding, embedding);
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
