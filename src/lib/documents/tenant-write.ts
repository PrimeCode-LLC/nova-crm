import { FieldValue } from "@/lib/db/document-shim/shim-firestore";

/**
 * Helper for stamping `organizationId` + audit timestamps on every tenant
 * write. Use this in every server route that writes to a `TENANT_COLLECTIONS`
 * collection (leads, accounts, contacts, deals, activityCounters, …).
 *
 * Example:
 *   await db.collection("leads").add(stampForCreate(orgId, payload, uid));
 *   await ref.update(stampForUpdate(payload, uid));
 *
 * Stamping at write time is the *only* layer that prevents a buggy client
 * from leaking data across tenants - the Firestore rules check `organizationId`
 * matches the user's claim, but they can't *invent* the field for you.
 */
export function stampForCreate<T extends Record<string, unknown>>(
  organizationId: string,
  payload: T,
  uid?: string,
): T & {
  organizationId: string;
  createdAt: ReturnType<typeof FieldValue.serverTimestamp>;
  updatedAt: ReturnType<typeof FieldValue.serverTimestamp>;
  createdByUid?: string;
  updatedByUid?: string;
} {
  return {
    ...payload,
    organizationId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...(uid ? { createdByUid: uid, updatedByUid: uid } : {}),
  };
}

export function stampForUpdate<T extends Record<string, unknown>>(
  payload: T,
  uid?: string,
): T & {
  updatedAt: ReturnType<typeof FieldValue.serverTimestamp>;
  updatedByUid?: string;
} {
  return {
    ...payload,
    updatedAt: FieldValue.serverTimestamp(),
    ...(uid ? { updatedByUid: uid } : {}),
  };
}
