import {
  deleteField,
  doc,
  increment,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { resolveOwnerManagerIdsClient } from "@/lib/firestore/resolve-owner-manager-ids-client";
import type { Lead, TimelineEvent } from "@/lib/types";

/** Stay under Firestore's 500-op batch limit with headroom. */
const MAX_OPS_PER_BATCH = 450;

const OMIT_FROM_LEAD_PATCH = new Set(["id", "createdAt", "updatedAt"]);

export type BulkOwnerReassignItem = {
  leadId: string;
  /** Previous owner (for timeline copy); empty = open queue. */
  previousOwnerId: string;
  leadPatch: Partial<Lead>;
  linkedSalesLeadId?: string;
  linkedSalesPatch?: Partial<Lead>;
  accountId?: string;
  contactId?: string;
  timeline: Pick<TimelineEvent, "id" | "leadId" | "type" | "actorId" | "summary" | "createdAt">;
};

function leadPayloadFromPatch(patch: Partial<Lead>, withActivityBump: boolean): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  for (const [key, val] of Object.entries(patch)) {
    if (OMIT_FROM_LEAD_PATCH.has(key)) continue;
    if (val === undefined) payload[key] = deleteField();
    else payload[key] = val;
  }
  if (withActivityBump) {
    payload.touches = increment(1);
    payload.lastActivityAt = serverTimestamp();
  }
  return payload;
}

/**
 * Bulk-assigns lead ownership using Firestore write batches.
 * Progress callback fires after each committed chunk (done count of items).
 */
export async function persistBulkOwnerReassignClient(
  db: Firestore,
  organizationId: string,
  items: BulkOwnerReassignItem[],
  nextOwnerId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (!items.length) return;

  const ownerManagerIds = await resolveOwnerManagerIdsClient(db, nextOwnerId);
  const leadOwnerManagerIds = ownerManagerIds;

  let batch = writeBatch(db);
  const opCount = { n: 0 };
  const accountsSeen = new Set<string>();
  const contactsSeen = new Set<string>();
  let done = 0;
  const total = items.length;

  const commitCurrent = async () => {
    if (opCount.n === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    opCount.n = 0;
    accountsSeen.clear();
    contactsSeen.clear();
    onProgress?.(done, total);
  };

  for (const item of items) {
    let needed = 2; // lead update + timeline
    if (item.linkedSalesLeadId && item.linkedSalesPatch && Object.keys(item.linkedSalesPatch).length) {
      needed += 1;
    }
    if (item.accountId?.trim() && !accountsSeen.has(item.accountId)) needed += 1;
    if (item.contactId?.trim() && !contactsSeen.has(item.contactId)) needed += 1;

    if (opCount.n + needed > MAX_OPS_PER_BATCH) {
      await commitCurrent();
    }

    const leadPatch = { ...item.leadPatch, ownerManagerIds };
    batch.update(
      doc(db, COLLECTIONS.leads, item.leadId),
      leadPayloadFromPatch(leadPatch, true),
    );
    opCount.n += 1;

    if (item.linkedSalesLeadId && item.linkedSalesPatch && Object.keys(item.linkedSalesPatch).length) {
      const linkedPatch = { ...item.linkedSalesPatch, ownerManagerIds };
      batch.update(
        doc(db, COLLECTIONS.leads, item.linkedSalesLeadId),
        leadPayloadFromPatch(linkedPatch, false),
      );
      opCount.n += 1;
    }

    const accountId = item.accountId?.trim();
    if (accountId && !accountsSeen.has(accountId)) {
      accountsSeen.add(accountId);
      batch.update(doc(db, COLLECTIONS.accounts, accountId), {
        ownerId: nextOwnerId,
        ownerManagerIds,
        updatedAt: serverTimestamp(),
      });
      opCount.n += 1;
    }

    const contactId = item.contactId?.trim();
    if (contactId && !contactsSeen.has(contactId)) {
      contactsSeen.add(contactId);
      batch.update(doc(db, COLLECTIONS.contacts, contactId), {
        ownerId: nextOwnerId,
        ownerManagerIds,
        updatedAt: serverTimestamp(),
      });
      opCount.n += 1;
    }

    batch.set(doc(db, COLLECTIONS.timelineEvents, item.timeline.id), {
      organizationId,
      leadId: item.timeline.leadId,
      leadOwnerId: nextOwnerId,
      leadOwnerManagerIds,
      type: item.timeline.type,
      actorId: item.timeline.actorId ?? null,
      summary: item.timeline.summary,
      payload: null,
      createdAt: item.timeline.createdAt,
    });
    opCount.n += 1;

    done += 1;
    if (done % 20 === 0) {
      onProgress?.(done, total);
    }
  }

  await commitCurrent();
  onProgress?.(total, total);
}
