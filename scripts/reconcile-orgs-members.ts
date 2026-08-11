/**
 * P2.5 — Reconcile Firestore organizations/members vs Postgres.
 *
 * Usage:
 *   npm run db:reconcile:orgs-members
 *   npm run db:reconcile:orgs-members -- --org=YOUR_ORG_ID
 *   npm run db:reconcile:orgs-members -- --sample=20
 *
 * Exit code 0 when report.clean; 1 when drift/errors.
 * Staging first — never production from a laptop (docs/ENVIRONMENTS.md).
 */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { disconnectPrisma } from "../src/lib/db/prisma";
import { runOrgsMembersReconcile } from "../src/lib/db/reconcile-orgs-members";

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
  console.log("P2.5 orgs/members reconcile", {
    organizationId: opts.organizationId ?? "(all)",
    sampleLimit: opts.sampleLimit ?? 50,
  });

  const report = await runOrgsMembersReconcile({
    ...opts,
    onProgress: (message) => console.log(message),
  });

  console.log(
    JSON.stringify(
      {
        clean: report.clean,
        counts: {
          firestoreOrganizations: report.firestoreOrganizationCount,
          postgresOrganizations: report.postgresOrganizationCount,
          firestoreMembers: report.firestoreMemberCount,
          postgresMembers: report.postgresMemberCount,
        },
        compared: {
          organizations: report.organizationsCompared,
          members: report.membersCompared,
        },
        missingInPostgres: report.missingInPostgres,
        missingInFirestore: report.missingInFirestore,
        fieldDiffs: report.fieldDiffs.slice(0, 50),
        fieldDiffTotal: report.fieldDiffs.length,
        errors: report.errors,
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
