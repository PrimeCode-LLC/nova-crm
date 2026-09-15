/**
 * Outreach circuit breaker — pauses sending on deliverability guardrails.
 */

import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { recordAudit } from "@/lib/documents/audit";
import { getOutreachConfigScorecard } from "@/lib/ai/eval/scorecard-server";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import { isDatabaseConfigured } from "@/lib/db/prisma";

export type CircuitBreakerState = {
  orgPaused: boolean;
  pausedArmIds: string[];
  reason?: string;
  trippedAt?: string;
  /** Trailing org baseline rates used for 2× arm trips. */
  baseline?: {
    unsubscribeRate: number;
    hardNoRate: number;
  };
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
    baseline:
      data.baseline && typeof data.baseline === "object"
        ? (data.baseline as CircuitBreakerState["baseline"])
        : undefined,
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

/** Mean rates across org scorecards with enough delivery (trailing proxy). */
async function orgTrailingBaseline(organizationId: string): Promise<{
  unsubscribeRate: number;
  hardNoRate: number;
}> {
  if (!isDatabaseConfigured()) {
    return { unsubscribeRate: 0.01, hardNoRate: 0.01 };
  }
  const cards = await withOrganizationScope(organizationId, async (tx) =>
    tx.outreachConfigScorecard.findMany({
      where: { organizationId, delivered: { gte: 50 } },
      select: { unsubscribeRate: true, hardNoRate: true },
      take: 50,
    }),
  );
  if (cards.length === 0) {
    return { unsubscribeRate: 0.01, hardNoRate: 0.01 };
  }
  const unsub =
    cards.reduce((s, c) => s + c.unsubscribeRate, 0) / cards.length;
  const hard = cards.reduce((s, c) => s + c.hardNoRate, 0) / cards.length;
  return {
    unsubscribeRate: Math.max(0.005, unsub),
    hardNoRate: Math.max(0.005, hard),
  };
}

export async function evaluateCircuitBreakerForConfig(input: {
  organizationId: string;
  configId: string;
  armId?: string;
}): Promise<CircuitBreakerState> {
  const scorecard = await getOutreachConfigScorecard(input.organizationId, input.configId);
  const current = await getCircuitBreakerState(input.organizationId);
  if (!scorecard || scorecard.sent < 50) return current;

  const baseline = await orgTrailingBaseline(input.organizationId);
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

  // Arm-level: unsubscribe or hard_no more than 2× trailing org baseline.
  const unsubTrip = scorecard.unsubscribeRate > baseline.unsubscribeRate * 2;
  const hardTrip = scorecard.hardNoRate > baseline.hardNoRate * 2;
  if ((unsubTrip || hardTrip) && input.armId) {
    pausedArmIds.add(input.armId);
    reason =
      reason ??
      `Arm ${input.armId} paused: unsub/hard_no >2× baseline (unsub=${(100 * scorecard.unsubscribeRate).toFixed(1)}% vs ${(100 * baseline.unsubscribeRate).toFixed(1)}%; hard_no=${(100 * scorecard.hardNoRate).toFixed(1)}% vs ${(100 * baseline.hardNoRate).toFixed(1)}%)`;
  }

  const next: CircuitBreakerState = {
    orgPaused,
    pausedArmIds: [...pausedArmIds],
    reason,
    trippedAt: orgPaused || pausedArmIds.size ? new Date().toISOString() : current.trippedAt,
    baseline,
  };

  if (
    orgPaused !== current.orgPaused ||
    pausedArmIds.size !== current.pausedArmIds.length ||
    [...pausedArmIds].some((id) => !current.pausedArmIds.includes(id))
  ) {
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

export async function assertSendingAllowed(
  organizationId: string,
  opts?: { armId?: string | null },
): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  const state = await getCircuitBreakerState(organizationId);
  if (state.orgPaused) {
    return { allowed: false, reason: state.reason ?? "Outreach paused by circuit breaker" };
  }
  const armId = opts?.armId?.trim();
  if (armId && state.pausedArmIds.includes(armId)) {
    return {
      allowed: false,
      reason: `Experiment arm ${armId} is paused by circuit breaker`,
    };
  }
  return { allowed: true };
}

/** Resolve armId from provenance for a followup or lead (best-effort). */
export async function resolveArmIdForSend(input: {
  organizationId: string;
  followupId?: string;
  leadId?: string;
}): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;
  return withOrganizationScope(input.organizationId, async (tx) => {
    if (input.followupId) {
      const row = await tx.sequenceStepProvenance.findFirst({
        where: {
          organizationId: input.organizationId,
          followupId: input.followupId,
        },
        select: { variantId: true, experimentId: true },
      });
      if (row?.variantId) return row.variantId;
    }
    if (input.leadId) {
      const row = await tx.sequenceStepProvenance.findFirst({
        where: {
          organizationId: input.organizationId,
          leadId: input.leadId,
          variantId: { not: null },
        },
        orderBy: { createdAt: "desc" },
        select: { variantId: true },
      });
      return row?.variantId ?? null;
    }
    return null;
  });
}
