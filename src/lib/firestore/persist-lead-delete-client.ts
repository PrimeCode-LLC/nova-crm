import { doc, serverTimestamp, writeBatch } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";

/**
 * Deletes a lead document and decrements the parent account's `leadCount`.
 * Call only when Firestore rules allow delete (org owner or admin).
 */
export async function persistLeadDeleteClient(
  db: Firestore,
  input: { leadId: string; accountId: string; accountLeadCount: number },
): Promise<void> {
  const nextCount = Math.max(0, input.accountLeadCount - 1);
  const batch = writeBatch(db);
  batch.delete(doc(db, COLLECTIONS.leads, input.leadId));
  batch.update(doc(db, COLLECTIONS.accounts, input.accountId), {
    leadCount: nextCount,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}
