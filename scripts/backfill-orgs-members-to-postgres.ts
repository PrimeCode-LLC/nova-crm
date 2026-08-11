/**
 * P2.4 — Idempotent ETL: Firestore organizations + members → Postgres.
 *
 * Usage (from repo root, with Admin + DATABASE_URL / MIGRATE env loaded):
 *   npm run db:backfill:orgs-members -- --dry-run
 *   npm run db:backfill:orgs-members -- --org=YOUR_ORG_ID
 *   npm run db:backfill:orgs-members -- --limit=10
 *
 * Requires:
 *   - FIREBASE_ADMIN_* (or equivalent) for Firestore reads
 *   - DATABASE_URL as nova_app (RLS-capable app role)
 *
 * Staging first — never point at production from a laptop (docs/ENVIRONMENTS.md).
 */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { disconnectPrisma } from "../src/lib/db/prisma";
import { runOrgsMembersBackfill } from "../src/lib/db/etl-orgs-members";

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const orgArg = argv.find((a) => a.startsWith("--org="));
  const limitArg = argv.find((a) => a.startsWith("--limit="));
  const organizationId = orgArg ? orgArg.slice("--org=".length).trim() : undefined;
  const limitRaw = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined;
  const limit =
    limitRaw != null && Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.floor(limitRaw)
      : undefined;
  return { dryRun, organizationId, limit };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log("P2.4 orgs/members backfill", {
    dryRun: opts.dryRun,
    organizationId: opts.organizationId ?? "(all)",
    limit: opts.limit ?? "(none)",
  });

  const stats = await runOrgsMembersBackfill({
    ...opts,
    onProgress: (message) => console.log(message),
  });

  console.log("Done:", stats);
  if (stats.errors.length > 0) {
    console.error(`Completed with ${stats.errors.length} error(s).`);
    process.exitCode = 1;
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
