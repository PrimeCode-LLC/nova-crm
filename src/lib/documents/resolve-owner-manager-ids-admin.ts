import type { Firestore } from "@/lib/db/document-shim/shim-firestore";
import { COLLECTIONS } from "@/lib/documents/collections";
import { ownerManagerIdsFromUser } from "@/lib/crm-owner-managers";
import type { User } from "@/lib/types";

function userFieldsFromData(data: Record<string, unknown>): Pick<User, "managerId" | "managerAncestorIds"> {
  return {
    managerId: typeof data.managerId === "string" ? data.managerId : undefined,
    managerAncestorIds: Array.isArray(data.managerAncestorIds)
      ? data.managerAncestorIds.filter((id): id is string => typeof id === "string")
      : undefined,
  };
}

/** Admin SDK: resolve denormalized manager ids for server writes / backfill. */
export async function resolveOwnerManagerIdsAdmin(
  db: Firestore,
  ownerId: string | undefined | null,
): Promise<string[]> {
  const oid = typeof ownerId === "string" ? ownerId.trim() : "";
  if (!oid) return [];
  const snap = await db.collection(COLLECTIONS.users).doc(oid).get();
  if (!snap.exists) return [];
  return ownerManagerIdsFromUser(userFieldsFromData(snap.data() as Record<string, unknown>));
}

/** Merge `ownerManagerIds` onto a CRM payload (empty when ownerId is blank / open queue). */
export async function withOwnerManagerIdsAdmin(
  db: Firestore,
  ownerId: string | undefined | null,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const ownerManagerIds = await resolveOwnerManagerIdsAdmin(db, ownerId);
  return { ...data, ownerManagerIds };
}

/** Merge `leadOwnerManagerIds` onto note/touchpoint/timeline payloads. */
export async function withLeadOwnerManagerIdsAdmin(
  db: Firestore,
  leadOwnerId: string | undefined | null,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const leadOwnerManagerIds = await resolveOwnerManagerIdsAdmin(db, leadOwnerId);
  return { ...data, leadOwnerManagerIds };
}
