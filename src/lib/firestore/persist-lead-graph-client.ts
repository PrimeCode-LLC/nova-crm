import { writeBatch, doc, setDoc } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { resolveOwnerManagerIdsClient } from "@/lib/firestore/resolve-owner-manager-ids-client";
import type { Account, Contact, Lead } from "@/lib/types";
import { scheduleCrmMirrorClient } from "@/lib/db/crm-mirror-client";

function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function withOwnerManagerIds(
  db: Firestore,
  ownerId: string | undefined,
  base: Record<string, unknown>,
  override?: string[],
): Promise<Record<string, unknown>> {
  const ids = override ?? (await resolveOwnerManagerIdsClient(db, ownerId));
  return { ...base, ownerManagerIds: ids };
}

export async function persistAccountCreateClient(
  db: Firestore,
  organizationId: string,
  account: Account,
  opts?: { ownerManagerIds?: string[] },
): Promise<void> {
  const data = await withOwnerManagerIds(
    db,
    account.ownerId,
    stripUndefined({ ...account, organizationId }),
    opts?.ownerManagerIds,
  );
  await setDoc(doc(db, COLLECTIONS.accounts, account.id), data);
  scheduleCrmMirrorClient("account", account.id);
}

export async function persistContactCreateClient(
  db: Firestore,
  organizationId: string,
  contact: Contact,
  opts?: { ownerManagerIds?: string[] },
): Promise<void> {
  const data = await withOwnerManagerIds(
    db,
    contact.ownerId,
    stripUndefined({ ...contact, organizationId }),
    opts?.ownerManagerIds,
  );
  await setDoc(doc(db, COLLECTIONS.contacts, contact.id), data);
  scheduleCrmMirrorClient("contact", contact.id);
}

export async function persistLeadCreateClient(
  db: Firestore,
  organizationId: string,
  lead: Lead,
  opts?: { ownerManagerIds?: string[] },
): Promise<void> {
  const data = await withOwnerManagerIds(
    db,
    lead.ownerId,
    stripUndefined({ ...lead, organizationId }),
    opts?.ownerManagerIds,
  );
  await setDoc(doc(db, COLLECTIONS.leads, lead.id), data);
  scheduleCrmMirrorClient("lead", lead.id);
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
  opts?: { ownerManagerIds?: string[] },
): Promise<void> {
  const ownerManagerIds =
    opts?.ownerManagerIds ??
    (await resolveOwnerManagerIdsClient(db, lead.ownerId || account.ownerId));
  const batch = writeBatch(db);
  const aRef = doc(db, COLLECTIONS.accounts, account.id);
  const cRef = doc(db, COLLECTIONS.contacts, contact.id);
  const lRef = doc(db, COLLECTIONS.leads, lead.id);

  batch.set(
    aRef,
    stripUndefined({
      ...account,
      organizationId,
      ownerManagerIds,
    }) as Record<string, unknown>,
  );
  batch.set(
    cRef,
    stripUndefined({
      ...contact,
      organizationId,
      ownerManagerIds,
    }) as Record<string, unknown>,
  );
  batch.set(
    lRef,
    stripUndefined({
      ...lead,
      organizationId,
      ownerManagerIds,
    }) as Record<string, unknown>,
  );

  await batch.commit();
  scheduleCrmMirrorClient("account", account.id);
  scheduleCrmMirrorClient("contact", contact.id);
  scheduleCrmMirrorClient("lead", lead.id);
}
