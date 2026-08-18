import { doc, getDoc, type Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
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

/** Client SDK: load owner user and return denormalized manager ids for CRM list rules. */
export async function resolveOwnerManagerIdsClient(
  db: Firestore | null,
  ownerId: string | undefined | null,
): Promise<string[]> {
  const oid = typeof ownerId === "string" ? ownerId.trim() : "";
  if (!oid || !db) return [];
  const snap = await getDoc(doc(db, COLLECTIONS.users, oid));
  if (!snap.exists()) return [];
  return ownerManagerIdsFromUser(userFieldsFromData(snap.data() as Record<string, unknown>));
}
