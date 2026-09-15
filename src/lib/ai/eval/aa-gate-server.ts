/**
 * Org-level A/A test gate for starting live experiments.
 * Persisted under organizations/{orgId}/settings/outreachAaGate
 */

import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";

const DOC = "outreachAaGate";

export type AaGateState = {
  clean: boolean;
  experimentId?: string;
  pBeat?: number;
  checkedAt?: string;
  leadCount?: number;
};

export async function getAaGateState(organizationId: string): Promise<AaGateState> {
  const db = getAdminDb();
  if (!db) return { clean: false };
  const snap = await db
    .collection(COLLECTIONS.organizations)
    .doc(organizationId)
    .collection("settings")
    .doc(DOC)
    .get();
  if (!snap.exists) return { clean: false };
  const data = snap.data() as Record<string, unknown>;
  return {
    clean: data.clean === true,
    experimentId: typeof data.experimentId === "string" ? data.experimentId : undefined,
    pBeat: typeof data.pBeat === "number" ? data.pBeat : undefined,
    checkedAt: typeof data.checkedAt === "string" ? data.checkedAt : undefined,
    leadCount: typeof data.leadCount === "number" ? data.leadCount : undefined,
  };
}

export async function setAaGateState(
  organizationId: string,
  state: AaGateState,
): Promise<void> {
  const db = getAdminDb();
  if (!db) return;
  await db
    .collection(COLLECTIONS.organizations)
    .doc(organizationId)
    .collection("settings")
    .doc(DOC)
    .set(
      {
        ...state,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
}

/** In-process balance check for an assignment set (no outcome simulation). */
export function assignmentBalanceLooksClean(input: {
  armCounts: number[];
  totalLeads: number;
}): boolean {
  if (input.armCounts.length < 2 || input.totalLeads < 10) return false;
  const max = Math.max(...input.armCounts);
  const min = Math.min(...input.armCounts);
  // Arms should be within 15% of total (same threshold as run-aa-test).
  return max - min < input.totalLeads * 0.15;
}
