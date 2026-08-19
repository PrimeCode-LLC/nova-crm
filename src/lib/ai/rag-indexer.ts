import { createOpenAI } from "@ai-sdk/openai";
import { embedMany } from "ai";
import { FieldValue } from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import { getAiProviderKeyServer } from "@/lib/ai/ai-secrets-server";
import { getOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import { recordAiUsage } from "@/lib/ai/usage-logger";

const CHUNK_SIZE = 1200;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
    i += CHUNK_SIZE;
  }
  return chunks.filter((c) => c.trim().length > 0);
}

export async function indexAiDocumentServer(input: {
  organizationId: string;
  documentId: string;
  userId: string;
}): Promise<{ ok: true; chunkCount: number } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const docRef = db
    .collection(COLLECTIONS.organizations)
    .doc(input.organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiDocuments)
    .doc(input.documentId);

  const snap = await docRef.get();
  if (!snap.exists) return { error: "Document not found" };

  const data = snap.data()!;
  const content = String(data.content ?? "");
  const libraryId = String(data.libraryId ?? "");
  const title = String(data.title ?? "Document");
  const knowledgeSection = (data.knowledgeSection as string | undefined) ?? null;
  const chunks = chunkText(content);

  const settings = await getOrganizationAiSettingsServer(input.organizationId);
  const provider = settings.embeddingProvider ?? "openai";
  const model = settings.embeddingModel ?? "text-embedding-3-small";
  const apiKey = await getAiProviderKeyServer(input.organizationId, provider);
  if (!apiKey) return { error: `No API key for ${provider}` };

  const started = Date.now();
  let embeddings: number[][] = [];

  if (provider === "openai") {
    const openai = createOpenAI({ apiKey });
    const result = await embedMany({
      model: openai.embedding(model),
      values: chunks,
    });
    embeddings = result.embeddings;
    await recordAiUsage({
      organizationId: input.organizationId,
      userId: input.userId,
      feature: "rag_index",
      provider,
      model,
      inputTokens: chunks.join("").length / 4,
      outputTokens: 0,
      latencyMs: Date.now() - started,
      status: "ok",
    });
  } else {
    embeddings = chunks.map(() => []);
  }

  const batch = db.batch();
  const oldChunks = await docRef.collection("chunks").get();
  for (const c of oldChunks.docs) batch.delete(c.ref);

  chunks.forEach((text, idx) => {
    const ref = docRef.collection("chunks").doc(`c_${idx}`);
    const vector = embeddings[idx] ?? [];
    batch.set(ref, {
      title,
      content: text,
      // Native Firestore vector enables `findNearest` KNN search. Falls back to []
      // for providers that do not return embeddings (still readable by cosine path).
      embedding: vector.length ? FieldValue.vector(vector) : [],
      // Denormalized so vector search + fallback can filter by org/library/section.
      organizationId: input.organizationId,
      libraryId,
      knowledgeSection,
      index: idx,
      updatedAt: new Date().toISOString(),
    });
  });

  // Use set+merge (not update) so indexing doesn't fail if the doc
  // was deleted concurrently (e.g. during reseeding).
  batch.set(
    docRef,
    {
      chunkCount: chunks.length,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  if (libraryId) {
    const libRef = db
      .collection(COLLECTIONS.organizations)
      .doc(input.organizationId)
      .collection(ORG_SUBCOLLECTIONS.aiLibraries)
      .doc(libraryId);
    batch.set(
      libRef,
      {
        chunkCount: FieldValue.increment(chunks.length - (data.chunkCount as number ?? 0)),
        lastIndexedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }

  await batch.commit();
  return { ok: true, chunkCount: chunks.length };
}
