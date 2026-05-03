import { deleteField, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { Lead } from "@/lib/types";

const OMIT_FROM_PATCH = new Set(["id", "createdAt", "updatedAt"]);

/**
 * Applies a partial lead update to the Firestore lead document.
 * `undefined` in the patch removes that optional field from the document.
 */
export async function persistLeadPatchClient(
  db: Firestore,
  leadId: string,
  patch: Partial<Lead>,
): Promise<void> {
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  for (const [key, val] of Object.entries(patch)) {
    if (OMIT_FROM_PATCH.has(key)) continue;
    if (val === undefined) {
      payload[key] = deleteField();
    } else {
      payload[key] = val;
    }
  }
  await updateDoc(doc(db, COLLECTIONS.leads, leadId), payload);
}
