import { writeBatch, doc, setDoc } from "@/lib/db/document-shim/shim-client-firestore";
import type { Firestore } from "@/lib/db/document-shim/shim-client-firestore";
import { persistCrmWriteClient } from "@/lib/db/crm-write-client";
import { scheduleCrmMirrorClient } from "@/lib/db/crm-mirror-client";
import { isPostgresSoleWriterCrmV1Enabled } from "@/lib/db/postgres-sole-writer-crm-flags";
import { COLLECTIONS } from "@/lib/documents/collections";
import { resolveOwnerManagerIdsClient } from "@/lib/documents/resolve-owner-manager-ids-client";
import type { Account, Contact, Lead } from "@/lib/types";

function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function withOwnerManagerIds(
  db: Firestore | null,
  ownerId: string | undefined,
  base: Record<string, unknown>,
  override?: string[],
): Promise<Record<string, unknown>> {
  const ids = override ?? (await resolveOwnerManagerIdsClient(db, ownerId));
  return { ...base, ownerManagerIds: ids };
}

export async function persistAccountCreateClient(
  db: Firestore | null,
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

  if (isPostgresSoleWriterCrmV1Enabled()) {
    await persistCrmWriteClient({
      action: "upsert",
      entity: "account",
      id: account.id,
      doc: data,
    });
    return;
  }

  if (!db) {
    throw new Error("Firestore is required when Postgres sole-writer is off");
  }

  await setDoc(doc(db, COLLECTIONS.accounts, account.id), data);
  scheduleCrmMirrorClient("account", account.id);
}

export async function persistContactCreateClient(
  db: Firestore | null,
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

  if (isPostgresSoleWriterCrmV1Enabled()) {
    await persistCrmWriteClient({
      action: "upsert",
      entity: "contact",
      id: contact.id,
      doc: data,
    });
    return;
  }

  if (!db) {
    throw new Error("Firestore is required when Postgres sole-writer is off");
  }

  await setDoc(doc(db, COLLECTIONS.contacts, contact.id), data);
  scheduleCrmMirrorClient("contact", contact.id);
}

export async function persistLeadCreateClient(
  db: Firestore | null,
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

  if (isPostgresSoleWriterCrmV1Enabled()) {
    await persistCrmWriteClient({
      action: "upsert",
      entity: "lead",
      id: lead.id,
      doc: data,
    });
    return;
  }

  if (!db) {
    throw new Error("Firestore is required when Postgres sole-writer is off");
  }

  await setDoc(doc(db, COLLECTIONS.leads, lead.id), data);
  scheduleCrmMirrorClient("lead", lead.id);
}

/**
 * Persists a new account + contact + lead graph for the signed-in user's tenant.
 * P6.2: when sole-writer flag on, writes Postgres only (atomic upsert_graph).
 */
export async function persistLeadGraphClient(
  db: Firestore | null,
  organizationId: string,
  account: Account,
  contact: Contact,
  lead: Lead,
  opts?: { ownerManagerIds?: string[] },
): Promise<void> {
  const ownerManagerIds =
    opts?.ownerManagerIds ??
    (await resolveOwnerManagerIdsClient(db, lead.ownerId || account.ownerId));

  const accountDoc = stripUndefined({
    ...account,
    organizationId,
    ownerManagerIds,
  });
  const contactDoc = stripUndefined({
    ...contact,
    organizationId,
    ownerManagerIds,
  });
  const leadDoc = stripUndefined({
    ...lead,
    organizationId,
    ownerManagerIds,
  });

  if (isPostgresSoleWriterCrmV1Enabled()) {
    await persistCrmWriteClient({
      action: "upsert_graph",
      account: { id: account.id, doc: accountDoc },
      contact: { id: contact.id, doc: contactDoc },
      lead: { id: lead.id, doc: leadDoc },
    });
    return;
  }

  if (!db) {
    throw new Error("Firestore is required when Postgres sole-writer is off");
  }

  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTIONS.accounts, account.id), accountDoc);
  batch.set(doc(db, COLLECTIONS.contacts, contact.id), contactDoc);
  batch.set(doc(db, COLLECTIONS.leads, lead.id), leadDoc);
  await batch.commit();
  scheduleCrmMirrorClient("account", account.id);
  scheduleCrmMirrorClient("contact", contact.id);
  scheduleCrmMirrorClient("lead", lead.id);
}
