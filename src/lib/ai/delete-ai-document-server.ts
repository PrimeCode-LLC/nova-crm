import { FieldValue } from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";

/**
 * Deletes an org AI document and its chunks, adjusting library counters.
 */
export async function deleteAiDocumentServer(input: {
  organizationId: string;
  documentId: string;
}): Promise<{ ok: true } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const ref = db
    .collection(COLLECTIONS.organizations)
    .doc(input.organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiDocuments)
    .doc(input.documentId);

  const snap = await ref.get();
  if (!snap.exists) return { ok: true };

  const data = snap.data()!;
  const libraryId = String(data.libraryId ?? "");
  const prevChunks = (data.chunkCount as number | undefined) ?? 0;

  const chunks = await ref.collection("chunks").get();
  const batch = db.batch();
  for (const c of chunks.docs) batch.delete(c.ref);
  batch.delete(ref);

  if (libraryId) {
    const libRef = db
      .collection(COLLECTIONS.organizations)
      .doc(input.organizationId)
      .collection(ORG_SUBCOLLECTIONS.aiLibraries)
      .doc(libraryId);
    batch.set(
      libRef,
      {
        documentCount: FieldValue.increment(-1),
        chunkCount: FieldValue.increment(-prevChunks),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }

  await batch.commit();
  return { ok: true };
}

/** Deletes every AI document whose sourceRef matches (e.g. contentCapture:id). */
export async function deleteAiDocumentsBySourceRefServer(input: {
  organizationId: string;
  sourceRef: string;
}): Promise<void> {
  const db = getAdminDb();
  if (!db) return;

  const snap = await db
    .collection(COLLECTIONS.organizations)
    .doc(input.organizationId)
    .collection(ORG_SUBCOLLECTIONS.aiDocuments)
    .where("sourceRef", "==", input.sourceRef)
    .limit(20)
    .get();

  for (const doc of snap.docs) {
    await deleteAiDocumentServer({
      organizationId: input.organizationId,
      documentId: doc.id,
    });
  }
}
