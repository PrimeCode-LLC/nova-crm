/**
 * Export pairwise comparisons for human calibration.
 * Usage: npx tsx scripts/calibrate-judge.ts --org=<orgId>
 * Gate: do not use judge scores in promotion until agreement > 70%.
 */

import { judgeHumanAgreement } from "../src/lib/ai/eval/judge";

async function main() {
  console.info(`
Judge calibration
-----------------
1. Export ~30 pairwise comparisons from eval runs (A vs B on same golden item).
2. Have a human label the winner (A / B / tie) without seeing the judge result.
3. Compute agreement with judgeHumanAgreement().

Gate: agreement must exceed 0.70 before judge win-rate is used in promotion.
`);
  // Demo of the metric helper with empty input
  console.info({ agreement: judgeHumanAgreement([]), note: "Replace with real labeled pairs" });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
