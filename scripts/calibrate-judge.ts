/**
 * Export pairwise comparisons from eval runs for human calibration.
 * Usage:
 *   npx tsx scripts/calibrate-judge.ts --org=<organizationId> [--out=judge-pairs.json]
 *   npx tsx scripts/calibrate-judge.ts --org=<organizationId> --labels=judge-labels.json
 *
 * Gate: do not flip JUDGE_GATES_PROMOTION until agreement > 0.70.
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { withOrganizationScope } from "../src/lib/db/tenant-scope";
import { isDatabaseConfigured } from "../src/lib/db/prisma";
import { judgeHumanAgreement } from "../src/lib/ai/eval/judge";

type ExportedPair = {
  evalResultId: string;
  evalRunId: string;
  datasetItemId: string;
  judgeWinner: string;
  judgeRationale: string | null;
  humanWinner?: string;
};

function argValue(prefix: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function exportPairs(organizationId: string): Promise<ExportedPair[]> {
  return withOrganizationScope(organizationId, async (tx) => {
    const runs = await tx.evalRun.findMany({
      where: {
        organizationId,
        status: "completed",
        comparedToConfigId: { not: null },
      },
      orderBy: { finishedAt: "desc" },
      take: 5,
    });
    if (runs.length === 0) return [];

    const results = await tx.evalResult.findMany({
      where: {
        organizationId,
        evalRunId: { in: runs.map((r) => r.id) },
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    });

    const pairs: ExportedPair[] = [];
    for (const r of results) {
      const scores = (r.judgeScores ?? {}) as Record<string, unknown>;
      const winnerLabel =
        typeof scores.winnerLabel === "string"
          ? scores.winnerLabel
          : typeof scores.winner === "string"
            ? scores.winner
            : null;
      if (!winnerLabel || winnerLabel === "error" || scores.error) continue;
      pairs.push({
        evalResultId: r.id,
        evalRunId: r.evalRunId,
        datasetItemId: r.datasetItemId,
        judgeWinner: winnerLabel,
        judgeRationale: r.judgeNotes,
      });
      if (pairs.length >= 30) break;
    }
    return pairs;
  });
}

async function main() {
  if (!isDatabaseConfigured()) {
    console.error("DATABASE_URL not configured");
    process.exit(1);
  }

  const organizationId = argValue("--org=");
  if (!organizationId) {
    console.error(
      "Usage: npx tsx scripts/calibrate-judge.ts --org=<organizationId> [--out=judge-pairs.json] [--labels=judge-labels.json]",
    );
    process.exit(1);
  }

  const labelsPath = argValue("--labels=");
  if (labelsPath) {
    if (!existsSync(labelsPath)) {
      console.error(`Labels file not found: ${labelsPath}`);
      process.exit(1);
    }
    const labeled = JSON.parse(readFileSync(labelsPath, "utf8")) as ExportedPair[];
    const pairs = labeled
      .filter((p) => p.humanWinner && p.judgeWinner)
      .map((p) => ({
        judgeWinner: p.judgeWinner,
        humanWinner: p.humanWinner!,
      }));
    const agreement = judgeHumanAgreement(pairs);
    console.info({
      labeled: pairs.length,
      agreement,
      gate: agreement > 0.7 ? "PASS — safe to enable JUDGE_GATES_PROMOTION" : "FAIL — keep judge display-only",
    });
    return;
  }

  const pairs = await exportPairs(organizationId);
  const outPath = argValue("--out=") ?? "judge-pairs.json";
  writeFileSync(outPath, JSON.stringify(pairs, null, 2));
  console.info({
    exported: pairs.length,
    outPath,
    next: `Have a human fill humanWinner (control|variant|tie) on each row, then re-run with --labels=${outPath}`,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
