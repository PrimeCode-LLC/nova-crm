import { FieldValue } from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";

export type RagVectorHealthStatus = "active" | "fallback" | "not_indexed";

export type RagVectorHealth = {
  status: RagVectorHealthStatus;
  /** Short badge label for the admin UI. */
  label: string;
  /** One-line explanation of why this status was chosen. */
  detail: string;
  sampledChunks: number;
  nativeVectorChunks: number;
  legacyArrayChunks: number;
  missingEmbeddingChunks: number;
  /** Whether a live `findNearest` probe succeeded. Null if not attempted. */
  findNearestOk: boolean | null;
};

function isNativeVectorEmbedding(value: unknown): boolean {
  if (!value || Array.isArray(value)) return false;
  const maybe = value as { toArray?: () => number[] };
  return typeof maybe.toArray === "function";
}

function embeddingToArray(value: unknown): number[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value as number[];
  const maybe = value as { toArray?: () => number[] };
  if (typeof maybe.toArray === "function") return maybe.toArray();
  return undefined;
}

/**
 * Cheap admin health check for Firestore native vector RAG.
 * Samples a few chunks and optionally probes `findNearest` so the UI can show
 * Active vs Fallback without requiring a full retrieval run.
 */
export async function probeRagVectorHealthServer(
  organizationId: string,
): Promise<RagVectorHealth> {
  const empty = (partial: Partial<RagVectorHealth> & Pick<RagVectorHealth, "status" | "label" | "detail">): RagVectorHealth => ({
    sampledChunks: 0,
    nativeVectorChunks: 0,
    legacyArrayChunks: 0,
    missingEmbeddingChunks: 0,
    findNearestOk: null,
    ...partial,
  });

  const db = getAdminDb();
  if (!db) {
    return empty({
      status: "fallback",
      label: "Fallback",
      detail: "Database not configured - retrieval cannot run.",
    });
  }

  const docsSnap = await db
    .collection(COLLECTIONS.organizations)
    .doc(organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiDocuments)
    .limit(4)
    .get();

  if (docsSnap.empty) {
    return empty({
      status: "not_indexed",
      label: "Not indexed",
      detail: "No knowledge documents yet - seed or add documents first.",
    });
  }

  let sampledChunks = 0;
  let nativeVectorChunks = 0;
  let legacyArrayChunks = 0;
  let missingEmbeddingChunks = 0;
  let probeVector: number[] | undefined;

  for (const docSnap of docsSnap.docs) {
    const chunksSnap = await docSnap.ref.collection("chunks").limit(6).get();
    for (const chunkSnap of chunksSnap.docs) {
      sampledChunks += 1;
      const embedding = chunkSnap.data().embedding;
      if (isNativeVectorEmbedding(embedding)) {
        nativeVectorChunks += 1;
        if (!probeVector) {
          probeVector = embeddingToArray(embedding);
        }
      } else if (Array.isArray(embedding) && embedding.length > 0) {
        legacyArrayChunks += 1;
      } else {
        missingEmbeddingChunks += 1;
      }
    }
  }

  if (sampledChunks === 0) {
    return empty({
      status: "not_indexed",
      label: "Not indexed",
      detail: "Documents exist but have no chunks yet - re-seed or re-index.",
      sampledChunks,
    });
  }

  if (nativeVectorChunks === 0) {
    return {
      status: "fallback",
      label: "Fallback",
      detail:
        legacyArrayChunks > 0
          ? "Chunks still use legacy array embeddings. Re-seed / re-index to write native Firestore vectors."
          : "Sampled chunks have no usable embeddings. Re-seed with an embedding provider configured.",
      sampledChunks,
      nativeVectorChunks,
      legacyArrayChunks,
      missingEmbeddingChunks,
      findNearestOk: null,
    };
  }

  // Live probe: only proves the vector index + native storage path.
  let findNearestOk: boolean | null = null;
  let findNearestError: string | undefined;
  if (probeVector?.length) {
    try {
      const snap = await db
        .collectionGroup("chunks")
        .where("organizationId", "==", organizationId)
        .findNearest({
          vectorField: "embedding",
          queryVector: FieldValue.vector(probeVector),
          limit: 1,
          distanceMeasure: "COSINE",
        })
        .get();
      findNearestOk = !snap.empty;
      if (snap.empty) {
        findNearestError = "findNearest returned no neighbors";
      }
    } catch (err) {
      findNearestOk = false;
      findNearestError = err instanceof Error ? err.message : String(err);
    }
  }

  if (findNearestOk) {
    const mixed =
      legacyArrayChunks > 0
        ? ` Mixed storage: ${nativeVectorChunks} native / ${legacyArrayChunks} legacy in sample - re-seed to convert remaining.`
        : "";
    return {
      status: "active",
      label: "Active",
      detail: `Firestore vector search is live (findNearest OK).${mixed}`,
      sampledChunks,
      nativeVectorChunks,
      legacyArrayChunks,
      missingEmbeddingChunks,
      findNearestOk,
    };
  }

  const indexHint =
    findNearestError && /index|FAILED_PRECONDITION|requires an index/i.test(findNearestError)
      ? " Deploy firestore vector indexes (`firebase deploy --only firestore:indexes`) and wait until they are Enabled."
      : findNearestError
        ? ` Probe error: ${findNearestError.slice(0, 160)}`
        : " findNearest did not return neighbors yet.";

  return {
    status: "fallback",
    label: "Fallback",
    detail: `Native vectors are stored, but vector search is not usable yet - using in-app cosine scan.${indexHint}`,
    sampledChunks,
    nativeVectorChunks,
    legacyArrayChunks,
    missingEmbeddingChunks,
    findNearestOk,
  };
}
