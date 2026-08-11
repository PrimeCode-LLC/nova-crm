/**
 * P2.6–P2.9 — Backfill accounts → contacts → leads → deals into Postgres.
 *
 *   npm run db:backfill:crm -- --dry-run
 *   npm run db:backfill:crm -- --org=ORG_ID --limit=100
 */

import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { disconnectPrisma } from "../src/lib/db/prisma";
import { runCrmEntitiesBackfill } from "../src/lib/db/etl-crm-entities";

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
  console.log("P2.6–P2.9 CRM backfill", opts);
  const stats = await runCrmEntitiesBackfill({
    ...opts,
    onProgress: (m) => console.log(m),
  });
  console.log("Done:", JSON.stringify(stats, null, 2));
  if (stats.errors.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma().catch(() => undefined);
  });
