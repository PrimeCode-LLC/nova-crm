/**
 * @deprecated Dual-write removed (P7). Re-exports crm-types for legacy imports.
 */

export {
  accountRowFromFirestore,
  contactRowFromFirestore,
  crmEntityFromCollection,
  dealRowFromFirestore,
  leadRowFromFirestore,
  toDate,
  type CrmEntity,
  type CrmFirestoreDoc,
} from "@/lib/db/crm-types";

/** No-op — Firestore dual-write removed. */
export async function mirrorCrmEntityAfterWrite(..._args: unknown[]): Promise<void> {}

/** No-op — Firestore dual-write removed. */
export async function mirrorCrmDocAfterWrite(..._args: unknown[]): Promise<void> {}

/** No-op — Firestore dual-write removed. */
export async function upsertCrmMirror(..._args: unknown[]): Promise<void> {}

/** No-op — Firestore dual-write removed. */
export async function deleteCrmMirror(..._args: unknown[]): Promise<void> {}
