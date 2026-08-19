import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import { getAiUsageRollupsServer } from "@/lib/ai/usage-logger";
import { estimateTokenCostUsd } from "@/lib/ai/pricing-table";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";

function parseRange(param: string | null): number {
  if (param === "7d") return 7;
  if (param === "90d") return 90;
  return 30;
}

export async function GET(req: Request) {
  const g = await guardAdminFeature("ai_knowledge");
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const days = parseRange(url.searchParams.get("range"));
  const orgId = g.ctx.session.organizationId;

  const rollups = await getAiUsageRollupsServer(orgId, days);

  let totalRequests = 0;
  let totalInput = 0;
  let totalOutput = 0;
  const byUserAgg: Record<
    string,
    { displayName?: string; requests: number; inputTokens: number; outputTokens: number }
  > = {};
  const byFeatureAgg: Record<
    string,
    { requests: number; inputTokens: number; outputTokens: number }
  > = {};

  for (const day of rollups) {
    totalRequests += day.requestCount ?? 0;
    totalInput += day.totalInputTokens ?? 0;
    totalOutput += day.totalOutputTokens ?? 0;
    for (const [uid, u] of Object.entries(day.byUser ?? {})) {
      const prev = byUserAgg[uid] ?? {
        displayName: u.displayName,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      byUserAgg[uid] = {
        displayName: u.displayName ?? prev.displayName,
        requests: prev.requests + u.requests,
        inputTokens: prev.inputTokens + u.inputTokens,
        outputTokens: prev.outputTokens + u.outputTokens,
      };
    }
    for (const [feat, f] of Object.entries(day.byFeature ?? {})) {
      const prev = byFeatureAgg[feat] ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
      byFeatureAgg[feat] = {
        requests: prev.requests + f.requests,
        inputTokens: prev.inputTokens + f.inputTokens,
        outputTokens: prev.outputTokens + f.outputTokens,
      };
    }
  }

  const estimatedCostUsd = estimateTokenCostUsd("gpt-4o-mini", totalInput, totalOutput);

  const featureFilter = url.searchParams.get("feature");
  let recentEvents: unknown[] = [];
  const db = getAdminDb();
  if (db && featureFilter) {
    const snap = await db
      .collection(COLLECTIONS.organizations)
      .doc(orgId)
      .collection(ORG_SUBCOLLECTIONS.aiUsageEvents)
      .where("feature", "==", featureFilter)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get()
      .catch(() => null);
    if (snap) {
      recentEvents = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
  }

  return NextResponse.json({
    range: days,
    totals: {
      requests: totalRequests,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      estimatedCostUsd,
    },
    daily: rollups,
    byUser: Object.entries(byUserAgg)
      .map(([userId, stats]) => ({ userId, ...stats }))
      .sort((a, b) => b.requests - a.requests),
    byFeature: Object.entries(byFeatureAgg).map(([feature, stats]) => ({
      feature,
      ...stats,
    })),
    recentEvents,
  });
}
