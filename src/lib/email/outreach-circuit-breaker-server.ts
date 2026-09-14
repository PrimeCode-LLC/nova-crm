/**
 * Outreach circuit breaker — pauses sending on deliverability guardrails.
 */

import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { recordAudit } from "@/lib/documents/audit";
import { getOutreachConfigScorecard } from "@/lib/ai/eval/scorecard-server";

export type CircuitBreakerState = {
  orgPaused: boolean;
  pausedArmIds: string[];
  reason?: string;
  trippedAt?: string;
};

const ORG_SETTINGS_DOC = "outreachCircuitBreaker";

export async function getCircuitBreakerState(
  organizationId: string,
): Promise<CircuitBreakerState> {
  const db = getAdminDb();
  if (!db) return { orgPaused: false, pausedArmIds: [] };
  const snap = await db
    .collection(COLLECTIONS.organizations)
    .doc(organizationId)
    .collection("settings")
    .doc(ORG_SETTINGS_DOC)
    .get();
  if (!snap.exists) return { orgPaused: false, pausedArmIds: [] };
  const data = snap.data() as Record<string, unknown>;
  return {
    orgPaused: data.orgPaused === true,
    pausedArmIds: Array.isArray(data.pausedArmIds)
      ? data.pausedArmIds.map(String)
      : [],
    reason: typeof data.reason === "string" ? data.reason : undefined,
    trippedAt: typeof data.trippedAt === "string" ? data.trippedAt : undefined,
  };
}

async function setCircuitBreakerState(
  organizationId: string,
  state: CircuitBreakerState,
): Promise<void> {
  const db = getAdminDb();
  if (!db) return;
  await db
    .collection(COLLECTIONS.organizations)
    .doc(organizationId)
    .collection("settings")
    .doc(ORG_SETTINGS_DOC)
    .set(
      {
        ...state,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
}

export async function evaluateCircuitBreakerForConfig(input: {
  organizationId: string;
  configId: string;
  armId?: string;
}): Promise<CircuitBreakerState> {
  const scorecard = await getOutreachConfigScorecard(input.organizationId, input.configId);
  const current = await getCircuitBreakerState(input.organizationId);
  if (!scorecard || scorecard.sent < 50) return current;

  let orgPaused = current.orgPaused;
  const pausedArmIds = new Set(current.pausedArmIds);
  let reason = current.reason;

  if (scorecard.bounceRate > 0.03) {
    orgPaused = true;
    reason = `Hard bounce rate ${(100 * scorecard.bounceRate).toFixed(1)}% > 3%`;
  }
  if (scorecard.spamComplaintRate > 0.001) {
    orgPaused = true;
    reason = `Spam complaint rate ${(100 * scorecard.spamComplaintRate).toFixed(2)}% > 0.1%`;
  }
  // Arm-level: unsubscribe or hard_no at 2x of a soft baseline 1%
  if (scorecard.unsubscribeRate > 0.02 || scorecard.hardNoRate > 0.02) {
    if (input.armId) pausedArmIds.add(input.armId);
    reason =
      reason ??
      `Unsubscribe/hard_no elevated (unsub=${(100 * scorecard.unsubscribeRate).toFixed(1)}% hard_no=${(100 * scorecard.hardNoRate).toFixed(1)}%)`;
  }

  const next: CircuitBreakerState = {
    orgPaused,
    pausedArmIds: [...pausedArmIds],
    reason,
    trippedAt: orgPaused || pausedArmIds.size ? new Date().toISOString() : current.trippedAt,
  };

  if (orgPaused !== current.orgPaused || pausedArmIds.size !== current.pausedArmIds.length) {
    await setCircuitBreakerState(input.organizationId, next);
    void recordAudit({
      organizationId: input.organizationId,
      actorUid: "system",
      event: "outreach.circuit_breaker_trip",
      meta: { configId: input.configId, ...next },
    });
  }

  return next;
}

export async function clearCircuitBreaker(input: {
  organizationId: string;
  clearedBy: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await setCircuitBreakerState(input.organizationId, {
      orgPaused: false,
      pausedArmIds: [],
      reason: undefined,
      trippedAt: undefined,
    });
    void recordAudit({
      organizationId: input.organizationId,
      actorUid: input.clearedBy,
      event: "outreach.circuit_breaker_clear",
      meta: {},
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function assertSendingAllowed(organizationId: string): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  const state = await getCircuitBreakerState(organizationId);
  if (state.orgPaused) {
    return { allowed: false, reason: state.reason ?? "Outreach paused by circuit breaker" };
  }
  return { allowed: true };
}
