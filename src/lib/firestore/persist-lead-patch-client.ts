import { deleteField, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { persistCrmWriteClient } from "@/lib/db/crm-write-client";
import { scheduleCrmMirrorClient } from "@/lib/db/crm-mirror-client";
import { isPostgresSoleWriterCrmV1Enabled } from "@/lib/db/postgres-sole-writer-crm-flags";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { resolveOwnerManagerIdsClient } from "@/lib/firestore/resolve-owner-manager-ids-client";
import type { Lead } from "@/lib/types";

const OMIT_FROM_PATCH = new Set(["id", "createdAt", "updatedAt"]);

/**
 * Applies a partial lead update.
 * `undefined` in the patch removes that optional field.
 * When `ownerId` changes, refreshes denormalized `ownerManagerIds`.
 * P6.2: when sole-writer flag on, writes Postgres only (no Firestore).
 */
export async function persistLeadPatchClient(
  db: Firestore | null,
  leadId: string,
  patch: Partial<Lead>,
  opts?: { ownerManagerIds?: string[] },
): Promise<void> {
  const unset: string[] = [];
  const patchPayload: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(patch)) {
    if (OMIT_FROM_PATCH.has(key)) continue;
    if (val === undefined) unset.push(key);
    else patchPayload[key] = val;
  }
  if (patch.ownerId !== undefined) {
    patchPayload.ownerManagerIds =
      opts?.ownerManagerIds ??
      (db
        ? await resolveOwnerManagerIdsClient(db, patch.ownerId)
        : []);
  }

  if (isPostgresSoleWriterCrmV1Enabled()) {
    await persistCrmWriteClient({
      action: "patch",
      entity: "lead",
      id: leadId,
      patch: patchPayload,
      unset,
    });
    return;
  }

  if (!db) {
    throw new Error("Firestore is required when Postgres sole-writer is off");
  }

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
  if (patch.ownerId !== undefined) {
    payload.ownerManagerIds = patchPayload.ownerManagerIds;
  }
  await updateDoc(doc(db, COLLECTIONS.leads, leadId), payload);
  scheduleCrmMirrorClient("lead", leadId);
}
