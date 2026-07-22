import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";

/** Default pool generation when an org has never bumped / stamped an epoch. */
export const DEFAULT_INTAKE_POOL_EPOCH = 1;

export function normalizeIntakePoolEpoch(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }
  return DEFAULT_INTAKE_POOL_EPOCH;
}

/** Effective epoch for a raw item (legacy rows without the field belong to epoch 1). */
export function effectiveItemPoolEpoch(poolEpoch: unknown): number {
  return normalizeIntakePoolEpoch(poolEpoch);
}

export async function getIntakePoolEpochServer(organizationId: string): Promise<number> {
  const db = getAdminDb();
  if (!db) return DEFAULT_INTAKE_POOL_EPOCH;
  const snap = await db.collection(COLLECTIONS.organizations).doc(organizationId).get();
  if (!snap.exists) return DEFAULT_INTAKE_POOL_EPOCH;
  return normalizeIntakePoolEpoch(snap.data()?.intakePoolEpoch);
}

/**
 * Instantly empties the visible intake pool by advancing the org epoch.
 * Old rows remain until cron cleanup; list/ingest only use the new epoch.
 */
export async function bumpIntakePoolEpochServer(input: {
  organizationId: string;
  userId: string;
}): Promise<{ ok: true; previousEpoch: number; epoch: number } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const ref = db.collection(COLLECTIONS.organizations).doc(input.organizationId);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { error: "Organization not found" as const };
    const previousEpoch = normalizeIntakePoolEpoch(snap.data()?.intakePoolEpoch);
    const epoch = previousEpoch + 1;
    tx.update(ref, {
      intakePoolEpoch: epoch,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: input.userId,
    });
    return { ok: true as const, previousEpoch, epoch };
  });

  return result;
}
