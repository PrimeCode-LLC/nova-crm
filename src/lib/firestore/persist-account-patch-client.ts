import { deleteField, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
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
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  for (const [key, val] of Object.entries(patch)) {
    if (OMIT.has(key)) continue;
    if (val === undefined) payload[key] = deleteField();
    else payload[key] = val;
  }
  if (patch.ownerId !== undefined) {
    payload.ownerManagerIds =
      opts?.ownerManagerIds ?? (await resolveOwnerManagerIdsClient(db, patch.ownerId));
  }
  await updateDoc(doc(db, COLLECTIONS.accounts, accountId), payload);
}
