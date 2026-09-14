/**
 * Run offline eval for a config.
 * Usage: npx tsx scripts/run-eval.ts --org=<orgId> --config=<configId>
 */

import { runOfflineEvalServer } from "../src/lib/ai/eval/run-eval-server";

async function main() {
  const org = process.argv.find((a) => a.startsWith("--org="))?.slice(6)?.trim();
  const config = process.argv.find((a) => a.startsWith("--config="))?.slice(9)?.trim();
  if (!org || !config) {
    console.error("Usage: npx tsx scripts/run-eval.ts --org=<orgId> --config=<configId>");
    process.exit(1);
  }
  const result = await runOfflineEvalServer({
    organizationId: org,
    configId: config,
    userId: "cli",
  });
  console.info(result);
  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
