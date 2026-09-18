/**
 * Seed synthetic docs and measure pushdown row-read reduction (local only).
 * Does not touch real tenant data — uses org id prefix `org-measure-`.
 */

import { config as loadEnv } from "dotenv";
loadEnv();
loadEnv({ path: ".env.local", override: true });

import { isDatabaseConfigured } from "@/lib/db/prisma";
import {
  deleteDocument,
  queryDocuments,
  queryDocumentsLegacyForTests,
  setDocument,
} from "@/lib/db/document-shim/store";
import { resetDocumentQuerySingleFlightForTests } from "@/lib/db/document-shim/query-singleflight";

async function timeMs<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const t0 = performance.now();
  const value = await fn();
  return { ms: performance.now() - t0, value };
}

async function main() {
  if (!isDatabaseConfigured()) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const organizationId = `org-measure-${Date.now()}`;
  const viewerUid = "viewer-1";
  const paths: string[] = [];
  const TOTAL = 400;
  const MATCHING = 8;

  console.log(`Seeding ${TOTAL} notes for ${organizationId} (${MATCHING} match authorId)…`);
  for (let i = 0; i < TOTAL; i += 1) {
    const path = `notes/measure-${Date.now()}-${i}`;
    paths.push(path);
    await setDocument(
      path,
      {
        organizationId,
        authorId: i < MATCHING ? viewerUid : `other-${i}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        body: `n-${i}`,
      },
      false,
    );
  }

  const spec = {
    collectionRoot: "notes",
    pathPrefix: "notes",
    organizationId,
    filters: [
      { field: "organizationId" as const, op: "==" as const, value: organizationId },
      { field: "authorId" as const, op: "==" as const, value: viewerUid },
    ],
    orderBy: { field: "createdAt", direction: "desc" as const },
    limit: 2000,
  };

  const unfiltered = await timeMs(() =>
    queryDocumentsLegacyForTests({
      collectionRoot: "notes",
      pathPrefix: "notes",
      organizationId,
      filters: [
        { field: "organizationId", op: "==", value: organizationId },
      ],
    }),
  );

  resetDocumentQuerySingleFlightForTests();
  process.env.DOCUMENT_SHIM_QUERY_STATS = "1";
  const legacy = await timeMs(() => queryDocumentsLegacyForTests(spec));
  resetDocumentQuerySingleFlightForTests();
  const pushed = await timeMs(() => queryDocuments(spec));

  console.log(
    JSON.stringify(
      {
        organizationId,
        seeded: TOTAL,
        matchingAuthor: MATCHING,
        unfilteredOrgRows: unfiltered.value.length,
        unfilteredMs: Math.round(unfiltered.ms),
        legacyFinalDocs: legacy.value.length,
        legacyMs: Math.round(legacy.ms),
        pushdownFinalDocs: pushed.value.length,
        pushdownMs: Math.round(pushed.ms),
        pathParity:
          legacy.value.map((d) => d.path).sort().join("|") ===
          pushed.value.map((d) => d.path).sort().join("|"),
        note: "Pushdown applies authorId in SQL so Postgres returns ~MATCHING rows instead of TOTAL before Node post-filter.",
      },
      null,
      2,
    ),
  );

  for (const path of paths) {
    await deleteDocument(path);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
