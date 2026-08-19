/**
 * P6.3 — Archive Firestore CRM collections to local JSONL.
 *
 *   npm run db:export:firestore-crm -- --dry-run
 *   npm run db:export:firestore-crm -- --org=ORG_ID
 *   npm run db:export:firestore-crm -- --full
 *   npm run db:export:firestore-crm -- --out=archives/my-export
 *
 * Requires FIREBASE_ADMIN_* in .env.local. Output lands under archives/ (gitignored).
 * For production-scale managed exports, also see companion P6.3 (gcloud firestore export).
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { runFirestoreCrmArchive } from "../src/lib/db/export-firestore-crm-archive";

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
      ? Math.floor(limitRaw)
      : undefined;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const defaultOut = path.join("archives", `firestore-crm-${stamp}`);
  const outDir = path.resolve(outArg ? outArg.slice("--out=".length).trim() : defaultOut);

  return { organizationId, outDir, dryRun, full, limitPerCollection };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log("P6.3 Firestore CRM archive", {
    outDir: opts.outDir,
    dryRun: opts.dryRun,
    full: opts.full,
    organizationId: opts.organizationId ?? null,
    limitPerCollection: opts.limitPerCollection ?? null,
  });

  const result = await runFirestoreCrmArchive({
    ...opts,
    onProgress: (m) => console.log(m),
  });

  console.log(
    JSON.stringify(
      {
        outDir: result.outDir,
        dryRun: result.dryRun,
        full: result.full,
        totalDocs: result.totalDocs,
        errors: result.errors,
        collections: result.collections.map((c) => ({
          collection: c.collection,
          docs: c.docs,
          bytes: c.bytes,
        })),
      },
      null,
      2,
    ),
  );

  if (result.errors.length > 0) {
    console.error("Archive completed with errors.");
    process.exitCode = 1;
  } else {
    console.log(
      opts.dryRun
        ? "Dry run complete (no files written)."
        : `Archive written to ${result.outDir}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
