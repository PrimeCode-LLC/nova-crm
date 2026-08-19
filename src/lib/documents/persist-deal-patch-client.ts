import { deleteField, doc, serverTimestamp, updateDoc } from "@/lib/db/document-shim/shim-client-firestore";
import type { Firestore } from "@/lib/db/document-shim/shim-client-firestore";
import { persistCrmWriteClient } from "@/lib/db/crm-write-client";
import { scheduleCrmMirrorClient } from "@/lib/db/crm-mirror-client";
import { isPostgresSoleWriterCrmV1Enabled } from "@/lib/db/postgres-sole-writer-crm-flags";
import { COLLECTIONS } from "@/lib/documents/collections";
import { resolveOwnerManagerIdsClient } from "@/lib/documents/resolve-owner-manager-ids-client";
import type { Deal } from "@/lib/types";

const OMIT = new Set(["id", "createdAt", "updatedAt"]);

export async function persistDealPatchClient(
  db: Firestore | null,
  dealId: string,
  patch: Partial<Deal>,
  opts?: { ownerManagerIds?: string[] },
): Promise<void> {
  const unset: string[] = [];
  const patchPayload: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(patch)) {
    if (OMIT.has(key)) continue;
    if (val === undefined) unset.push(key);
    else patchPayload[key] = val;
  }
  if (patch.ownerId !== undefined) {
    patchPayload.ownerManagerIds =
      opts?.ownerManagerIds ?? (db ? await resolveOwnerManagerIdsClient(db, patch.ownerId) : []);
  }

  if (isPostgresSoleWriterCrmV1Enabled()) {
    await persistCrmWriteClient({
      action: "patch",
      entity: "deal",
      id: dealId,
      patch: patchPayload,
      unset,
    });
    return;
  }

  if (!db) {
    throw new Error("Firestore is required when Postgres sole-writer is off");
  }

  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  for (const [key, val] of Object.entries(patch)) {
    if (OMIT.has(key)) continue;
    if (val === undefined) payload[key] = deleteField();
    else payload[key] = val;
  }
  if (patch.ownerId !== undefined) {
    payload.ownerManagerIds = patchPayload.ownerManagerIds;
  }
  await updateDoc(doc(db, COLLECTIONS.deals, dealId), payload);
  scheduleCrmMirrorClient("deal", dealId);
}
