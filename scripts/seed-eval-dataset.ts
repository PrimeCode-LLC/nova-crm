/**
 * Seed a frozen golden eval dataset for an org.
 * Usage: npx tsx scripts/seed-eval-dataset.ts --org=<organizationId>
 */

import { seedGoldenDataset } from "../src/lib/ai/eval/dataset-server";
import { isDatabaseConfigured } from "../src/lib/db/prisma";

async function main() {
  const orgArg = process.argv.find((a) => a.startsWith("--org="));
  const organizationId = orgArg?.slice("--org=".length)?.trim();
  if (!organizationId) {
    console.error("Usage: npx tsx scripts/seed-eval-dataset.ts --org=<organizationId>");
    process.exit(1);
  }
  if (!isDatabaseConfigured()) {
    console.error("DATABASE_URL not configured");
    process.exit(1);
  }

  const result = await seedGoldenDataset(organizationId);
  console.info("[seed-eval-dataset]", { organizationId, ...result });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
