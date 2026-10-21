import type { Firestore } from "@/lib/db/document-shim/shim-client-firestore";
import { persistCrmWriteClient } from "@/lib/db/crm-write-client";
import { resolveOwnerManagerIdsClient } from "@/lib/documents/resolve-owner-manager-ids-client";
import type { Deal } from "@/lib/types";

/**
 * Saves a new deal for the signed-in user's tenant through /api/org/crm-write
 * (QA 2.10: the Deals page previously kept new deals in sessionStorage only).
 */
export async function persistDealCreateClient(
  db: Firestore | null,
  organizationId: string,
  deal: Deal,
): Promise<void> {
  const ownerManagerIds = await resolveOwnerManagerIdsClient(db, deal.ownerId);
  const doc: Record<string, unknown> = { ...deal, organizationId, ownerManagerIds };
  delete doc.id;
  for (const key of Object.keys(doc)) {
    if (doc[key] === undefined) delete doc[key];
  }
  await persistCrmWriteClient({ action: "upsert", entity: "deal", id: deal.id, doc });
}
