import { deleteField, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { persistCrmWriteClient } from "@/lib/db/crm-write-client";
import { scheduleCrmMirrorClient } from "@/lib/db/crm-mirror-client";
import { isPostgresSoleWriterCrmV1Enabled } from "@/lib/db/postgres-sole-writer-crm-flags";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { resolveOwnerManagerIdsClient } from "@/lib/firestore/resolve-owner-manager-ids-client";
import type { Account } from "@/lib/types";

const OMIT = new Set(["id", "createdAt", "updatedAt"]);

export async function persistAccountPatchClient(
  db: Firestore,
  accountId: string,
  patch: Partial<Account>,
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
      opts?.ownerManagerIds ?? (await resolveOwnerManagerIdsClient(db, patch.ownerId));
  }

  if (isPostgresSoleWriterCrmV1Enabled()) {
    await persistCrmWriteClient({
      action: "patch",
      entity: "account",
      id: accountId,
      patch: patchPayload,
      unset,
    });
    return;
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
  await updateDoc(doc(db, COLLECTIONS.accounts, accountId), payload);
  scheduleCrmMirrorClient("account", accountId);
}
