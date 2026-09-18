/**
 * Measure document-shim SQL row reads for hot workspace collections.
 *
 * Usage (local Compose):
 *   npx tsx scripts/measure-document-query-pushdown.ts [organizationId] [viewerUid]
 */

import { config as loadEnv } from "dotenv";
loadEnv();
loadEnv({ path: ".env.local", override: true });

import { isDatabaseConfigured } from "@/lib/db/prisma";
import {
  queryDocuments,
  queryDocumentsLegacyForTests,
} from "@/lib/db/document-shim/store";
import { resetDocumentQuerySingleFlightForTests } from "@/lib/db/document-shim/query-singleflight";
import { planQueryPushdown } from "@/lib/db/document-shim/query-pushdown";

async function timeMs<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const t0 = performance.now();
  const value = await fn();
  return { ms: performance.now() - t0, value };
}

async function main() {
  if (!isDatabaseConfigured()) {
    console.error("DATABASE_URL is not configured");
    process.exit(1);
  }

  const organizationId = (process.argv[2] || process.env.MEASURE_ORG_ID || "").trim();
  const viewerUid = (process.argv[3] || process.env.MEASURE_UID || "measure-user").trim();
  if (!organizationId) {
    console.error("Pass organizationId as argv[2] or MEASURE_ORG_ID");
    process.exit(1);
  }

  const collections: Array<{
    collectionRoot: string;
    eqField: string;
    orderBy: string;
    limit: number;
  }> = [
    { collectionRoot: "followups", eqField: "leadId", orderBy: "createdAt", limit: 2000 },
    { collectionRoot: "notes", eqField: "authorId", orderBy: "createdAt", limit: 2000 },
    { collectionRoot: "touchpoints", eqField: "actorId", orderBy: "occurredAt", limit: 2000 },
    { collectionRoot: "timelineEvents", eqField: "actorId", orderBy: "createdAt", limit: 400 },
    { collectionRoot: "leadTasks", eqField: "assigneeId", orderBy: "createdAt", limit: 2000 },
  ];

  console.log(
    JSON.stringify({
      organizationId,
      viewerUid,
      note: "legacy = full org collection then Node filter; pushdown = SQL filter then Node residual",
    }),
  );

  for (const c of collections) {
    resetDocumentQuerySingleFlightForTests();
    const spec = {
      collectionRoot: c.collectionRoot,
      pathPrefix: c.collectionRoot,
      organizationId,
      filters: [
        { field: "organizationId" as const, op: "==" as const, value: organizationId },
        { field: c.eqField, op: "==" as const, value: viewerUid },
      ],
      orderBy: { field: c.orderBy, direction: "desc" as const },
      limit: c.limit,
    };
    const plan = planQueryPushdown(spec);

    // Unfiltered org load (what SQL used to return before Node filter)
    const unfilteredSpec = {
      collectionRoot: c.collectionRoot,
      pathPrefix: c.collectionRoot,
      organizationId,
      filters: [
        { field: "organizationId" as const, op: "==" as const, value: organizationId },
      ],
    };

    const unfiltered = await timeMs(() => queryDocumentsLegacyForTests(unfilteredSpec));
    const legacy = await timeMs(() => queryDocumentsLegacyForTests(spec));
    resetDocumentQuerySingleFlightForTests();
    const pushed = await timeMs(() => queryDocuments(spec));

    console.log(
      JSON.stringify({
        collection: c.collectionRoot,
        eqField: c.eqField,
        plan: {
          pushedFilters: plan.pushedFilters.map((f) => `${f.field}${f.op}`),
          pushLimit: plan.pushLimit,
          pushOrderBy: plan.pushOrderBy,
          reasons: plan.reasons,
        },
        unfilteredOrgRows: unfiltered.value.length,
        unfilteredMs: Math.round(unfiltered.ms),
        legacyFinalDocs: legacy.value.length,
        legacyMs: Math.round(legacy.ms),
        pushdownFinalDocs: pushed.value.length,
        pushdownMs: Math.round(pushed.ms),
        pathParity:
          legacy.value.map((d) => d.path).sort().join("|") ===
          pushed.value.map((d) => d.path).sort().join("|"),
        approxRowReadReduction:
          unfiltered.value.length === 0
            ? null
            : Number(
                (
                  1 -
                  Math.min(1, pushed.value.length / Math.max(1, unfiltered.value.length))
                ).toFixed(4),
              ),
      }),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
