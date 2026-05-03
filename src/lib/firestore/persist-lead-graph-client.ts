import { writeBatch, doc } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { Account, Contact, Lead } from "@/lib/types";

function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Persists a new account + contact + lead graph for the signed-in user's tenant.
 * Call only when Firebase Web SDK is configured and the user can write per Firestore rules.
 */
export async function persistLeadGraphClient(
  db: Firestore,
  organizationId: string,
  account: Account,
  contact: Contact,
  lead: Lead,
): Promise<void> {
  const batch = writeBatch(db);
  const aRef = doc(db, COLLECTIONS.accounts, account.id);
  const cRef = doc(db, COLLECTIONS.contacts, contact.id);
  const lRef = doc(db, COLLECTIONS.leads, lead.id);

  batch.set(
    aRef,
    stripUndefined({
      ...account,
      organizationId,
    }) as Record<string, unknown>,
  );
  batch.set(
    cRef,
    stripUndefined({
      ...contact,
      organizationId,
    }) as Record<string, unknown>,
  );
  batch.set(
    lRef,
    stripUndefined({
      ...lead,
      organizationId,
    }) as Record<string, unknown>,
  );

  await batch.commit();
}
