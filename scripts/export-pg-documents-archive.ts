/**
 * P6.3 — Archive pg_documents CRM collections to local JSONL.
 *
 *   npm run db:export:pg-documents -- --dry-run
 *   npm run db:export:pg-documents -- --org=ORG_ID
 *   npm run db:export:pg-documents -- --full
 *   npm run db:export:pg-documents -- --out=archives/my-export
 *
 * Requires DATABASE_URL in .env.local. Output lands under archives/ (gitignored).
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { runPgDocumentsArchive } from "../src/lib/db/export-pg-documents-archive";

function parseArgs(argv: string[]) {
  const orgArg = argv.find((a) => a.startsWith("--org="));
  const outArg = argv.find((a) => a.startsWith("--out="));
  const limitArg = argv.find((a) => a.startsWith("--limit="));
  const dryRun = argv.includes("--dry-run");
  const full = argv.includes("--full");
  const organizationId = orgArg ? orgArg.slice("--org=".length).trim() : undefined;
  const limitRaw = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined;
  const limitPerCollection =
    limitRaw != null && Number.isFinite(limitRaw) && limitRaw > 0
      ? limitRaw
      : undefined;
  const outDir = outArg ? outArg.slice("--out=".length).trim() : undefined;
  return { dryRun, full, organizationId, limitPerCollection, outDir };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const defaultOut = path.join("archives", `pg-documents-${stamp}`);
  const outDir = opts.outDir ?? defaultOut;

  console.log("Pg documents archive", {
    outDir,
    dryRun: opts.dryRun,
    full: opts.full,
    organizationId: opts.organizationId ?? "(all)",
    limitPerCollection: opts.limitPerCollection ?? "(none)",
  });

  const result = await runPgDocumentsArchive({
    outDir,
    organizationId: opts.organizationId,
    full: opts.full,
    dryRun: opts.dryRun,
    limitPerCollection: opts.limitPerCollection,
    onProgress: (msg) => console.log(msg),
  });

  console.log("Done.", result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
