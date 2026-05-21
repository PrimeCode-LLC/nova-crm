import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import type { AiFeatureKey, AiProvider, AiUsageDailyRollup } from "@/lib/ai/types";

export type RecordAiUsageInput = {
  organizationId: string;
  userId: string;
  userDisplayName?: string;
  feature: AiFeatureKey | "rag_index";
  provider: AiProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: "ok" | "error";
  errorCode?: string;
  filterHash?: string;
  leadId?: string;
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function recordAiUsage(input: RecordAiUsageInput): Promise<void> {
  try {
    const db = getAdminDb();
    if (!db) return;

    const createdAt = new Date().toISOString();
    const date = todayUtc();

    await db
      .collection(COLLECTIONS.organizations)
      .doc(input.organizationId)
      .collection(ORG_SUBCOLLECTIONS.aiUsageEvents)
      .add({
        organizationId: input.organizationId,
        userId: input.userId,
        userDisplayName: input.userDisplayName ?? null,
        feature: input.feature,
        provider: input.provider,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        latencyMs: input.latencyMs,
        status: input.status,
        errorCode: input.errorCode ?? null,
        filterHash: input.filterHash ?? null,
        leadId: input.leadId ?? null,
        createdAt,
      });

    const dailyRef = db
      .collection(COLLECTIONS.organizations)
      .doc(input.organizationId)
      .collection(ORG_SUBCOLLECTIONS.aiUsageDaily)
      .doc(date);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(dailyRef);
      const prev = snap.data() as AiUsageDailyRollup | undefined;
      const byFeature = { ...(prev?.byFeature ?? {}) };
      const feat = byFeature[input.feature] ?? {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      byFeature[input.feature] = {
        requests: feat.requests + 1,
        inputTokens: feat.inputTokens + input.inputTokens,
        outputTokens: feat.outputTokens + input.outputTokens,
      };

      const byUser = { ...(prev?.byUser ?? {}) };
      const u = byUser[input.userId] ?? {
        displayName: input.userDisplayName,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      byUser[input.userId] = {
        displayName: input.userDisplayName ?? u.displayName,
        requests: u.requests + 1,
        inputTokens: u.inputTokens + input.inputTokens,
        outputTokens: u.outputTokens + input.outputTokens,
      };

      tx.set(
        dailyRef,
        {
          date,
          organizationId: input.organizationId,
          requestCount: (prev?.requestCount ?? 0) + 1,
          totalInputTokens: (prev?.totalInputTokens ?? 0) + input.inputTokens,
          totalOutputTokens: (prev?.totalOutputTokens ?? 0) + input.outputTokens,
          byFeature,
          byUser,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
  } catch (e) {
    console.error("[ai-usage]", e);
  }
}

export async function getAiUsageRollupsServer(
  organizationId: string,
  days: number,
): Promise<AiUsageDailyRollup[]> {
  const db = getAdminDb();
  if (!db) return [];

  const out: AiUsageDailyRollup[] = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const snap = await db
      .collection(COLLECTIONS.organizations)
      .doc(organizationId)
      .collection(ORG_SUBCOLLECTIONS.aiUsageDaily)
      .doc(date)
      .get();
    if (snap.exists) {
      out.push(snap.data() as AiUsageDailyRollup);
    }
  }
  return out.reverse();
}
