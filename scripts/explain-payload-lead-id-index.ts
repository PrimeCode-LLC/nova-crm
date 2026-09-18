/**
 * One-shot EXPLAIN for Phase 1 pushdown index verification.
 * Usage: npx tsx scripts/explain-payload-lead-id-index.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../src/generated/prisma/client";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL unset");
    process.exit(1);
  }
  // Refuse obvious production markers — staging/dev only for this script.
  if (/prod|production/i.test(url) && !/staging|dev|local|127\.0\.0\.1|localhost/i.test(url)) {
    console.error("Refusing to run EXPLAIN against a URL that looks like production");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const adapter = new PrismaPg(pool);
  const p = new PrismaClient({ adapter });
  try {
    console.log("--- Prisma-like jsonb -> equality (v2 index target) ---\n");
    const rows = await p.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
      `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT path FROM pg_documents
      WHERE organization_id IS NOT NULL
        AND collection_root = 'followups'
        AND payload->'leadId' = to_jsonb('__explain_probe__'::text)
      LIMIT 50
      `,
    );
    for (const row of rows) {
      console.log(row["QUERY PLAN"]);
    }

    console.log("\n--- old text ->> equality (v1 index target) ---\n");
    const old = await p.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
      `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT path FROM pg_documents
      WHERE payload ? 'leadId'
        AND payload->>'leadId' = '__explain_probe__'
      LIMIT 50
      `,
    );
    for (const row of old) {
      console.log(row["QUERY PLAN"]);
    }

    console.log("\n--- index catalog (payload leadId related) ---\n");
    const idxs = await p.$queryRawUnsafe<
      Array<{ indexname: string; indexdef: string }>
    >(
      `
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'pg_documents'
        AND (indexdef ILIKE '%leadId%' OR indexdef ILIKE '%lead_id%')
      ORDER BY indexname
      `,
    );
    for (const row of idxs) {
      console.log(row.indexname + ":\n  " + row.indexdef);
    }
  } finally {
    await p.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
