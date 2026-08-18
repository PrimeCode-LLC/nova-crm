/**
 * P2.6–P2.9 — Reconcile accounts/contacts/leads/deals Firestore ↔ Postgres.
 *
 *   npm run db:reconcile:crm
 *   npm run db:reconcile:crm -- --org=ORG_ID --sample=20
 */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { disconnectPrisma } from "../src/lib/db/prisma";
import { runCrmEntitiesReconcile } from "../src/lib/db/reconcile-crm-entities";

function parseArgs(argv: string[]) {
  const orgArg = argv.find((a) => a.startsWith("--org="));
  const sampleArg = argv.find((a) => a.startsWith("--sample="));
  const organizationId = orgArg ? orgArg.slice("--org=".length).trim() : undefined;
  const sampleRaw = sampleArg
    ? Number(sampleArg.slice("--sample=".length))
    : undefined;
  const sampleLimit =
    sampleRaw != null && Number.isFinite(sampleRaw) && sampleRaw > 0
      ? Math.floor(sampleRaw)
      : undefined;
  return { organizationId, sampleLimit };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log("P2.6–P2.9 CRM reconcile", opts);
  const report = await runCrmEntitiesReconcile({
    ...opts,
    onProgress: (m) => console.log(m),
  });
  console.log(
    JSON.stringify(
      {
        clean: report.clean,
        errors: report.errors,
        byEntity: Object.fromEntries(
          Object.entries(report.byEntity).map(([k, v]) => [
            k,
            {
              firestoreCount: v.firestoreCount,
              postgresCount: v.postgresCount,
              missingInPostgres: v.missingInPostgres.slice(0, 20),
              missingInFirestore: v.missingInFirestore.slice(0, 20),
              missingInPostgresTotal: v.missingInPostgres.length,
              missingInFirestoreTotal: v.missingInFirestore.length,
              fieldDiffs: v.fieldDiffs.slice(0, 20),
              fieldDiffTotal: v.fieldDiffs.length,
              compared: v.compared,
            },
          ]),
        ),
      },
      null,
      2,
    ),
  );
  if (!report.clean) {
    console.error("Reconcile not clean.");
    process.exitCode = 1;
  } else {
    console.log("Reconcile clean.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma().catch(() => undefined);
  });
