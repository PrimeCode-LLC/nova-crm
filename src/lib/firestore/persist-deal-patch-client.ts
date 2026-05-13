import { deleteField, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { Deal } from "@/lib/types";

const OMIT = new Set(["id", "createdAt", "updatedAt"]);

export async function persistDealPatchClient(
  db: Firestore,
  dealId: string,
  patch: Partial<Deal>,
): Promise<void> {
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  for (const [key, val] of Object.entries(patch)) {
    if (OMIT.has(key)) continue;
    if (val === undefined) payload[key] = deleteField();
    else payload[key] = val;
  }
  await updateDoc(doc(db, COLLECTIONS.deals, dealId), payload);
}
