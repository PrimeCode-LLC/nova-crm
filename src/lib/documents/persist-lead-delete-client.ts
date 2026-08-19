import { doc, serverTimestamp, writeBatch } from "@/lib/db/document-shim/shim-client-firestore";
import type { Firestore } from "@/lib/db/document-shim/shim-client-firestore";
import { persistCrmWriteClient } from "@/lib/db/crm-write-client";
import { scheduleCrmMirrorClient } from "@/lib/db/crm-mirror-client";
import { isPostgresSoleWriterCrmV1Enabled } from "@/lib/db/postgres-sole-writer-crm-flags";
import { COLLECTIONS } from "@/lib/documents/collections";

/**
 * Deletes a lead document and decrements the parent account's `leadCount`.
 * P6.2: when sole-writer flag on, mutates Postgres only.
 */
export async function persistLeadDeleteClient(
  db: Firestore | null,
  input: { leadId: string; accountId: string; accountLeadCount: number },
): Promise<void> {
  const nextCount = Math.max(0, input.accountLeadCount - 1);

  if (isPostgresSoleWriterCrmV1Enabled()) {
    await persistCrmWriteClient({
      action: "delete",
      entity: "lead",
      id: input.leadId,
      accountId: input.accountId,
      accountLeadCount: nextCount,
    });
    return;
  }

  if (!db) {
    throw new Error("Firestore is required when Postgres sole-writer is off");
  }

  const batch = writeBatch(db);
  batch.delete(doc(db, COLLECTIONS.leads, input.leadId));
  batch.update(doc(db, COLLECTIONS.accounts, input.accountId), {
    leadCount: nextCount,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  scheduleCrmMirrorClient("lead", input.leadId, "delete");
  scheduleCrmMirrorClient("account", input.accountId);
}
