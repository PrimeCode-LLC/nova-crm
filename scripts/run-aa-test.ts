/**
 * A/A sanity check: two arms pointing at the SAME config should not show
 * P(A>B) > 0.8 on any primary rate after assignment.
 *
 * Usage: npx tsx scripts/run-aa-test.ts --org=<orgId> --config=<configId> [--leads=1000]
 *
 * Hard gate: do not start real experiments until this reports clean.
 */

import { createHash, randomUUID } from "node:crypto";
import { withOrganizationScope } from "../src/lib/db/tenant-scope";
import { isDatabaseConfigured } from "../src/lib/db/prisma";
import { assignLeadsToArms, persistAssignments } from "../src/lib/ai/eval/assignment-server";
import { betaPosterior, probVariantBeatsControl } from "../src/lib/ai/eval/posterior";

async function main() {
  const org = process.argv.find((a) => a.startsWith("--org="))?.slice(6)?.trim();
  const config = process.argv.find((a) => a.startsWith("--config="))?.slice(9)?.trim();
  const leadsN = Number(
    process.argv.find((a) => a.startsWith("--leads="))?.slice(8) ?? "1000",
  );
  if (!org || !config) {
    console.error(
      "Usage: npx tsx scripts/run-aa-test.ts --org=<orgId> --config=<configId> [--leads=1000]",
    );
    process.exit(1);
  }
  if (!isDatabaseConfigured()) {
    console.error("DATABASE_URL not configured");
    process.exit(1);
  }

  const experimentId = `exp-aa-${randomUUID()}`;
  const armA = `arm-${randomUUID()}`;
  const armB = `arm-${randomUUID()}`;

  await withOrganizationScope(org, async (tx) => {
    await tx.experiment.create({
      data: {
        id: experimentId,
        organizationId: org,
        name: "A/A sanity check",
        hypothesis: "Two identical arms should show no difference",
        status: "running",
        primaryMetric: "positiveReplyRate",
        stage: 1,
        minPerArm: Math.floor(leadsN / 2),
        startedAt: new Date(),
      },
    });
    await tx.experimentArm.createMany({
      data: [
        {
          id: armA,
          organizationId: org,
          experimentId,
          label: "A",
          configId: config,
          allocation: 50,
          isControl: true,
        },
        {
          id: armB,
          organizationId: org,
          experimentId,
          label: "B",
          configId: config,
          allocation: 50,
          isControl: false,
        },
      ],
    });
  });

  const leadIds = Array.from({ length: leadsN }, (_, i) =>
    createHash("sha1").update(`${experimentId}:lead:${i}`).digest("hex").slice(0, 24),
  );
  const assignments = assignLeadsToArms({
    experimentId,
    leadIds,
    arms: [
      { id: armA, allocation: 50, configId: config, label: "A", isControl: true },
      { id: armB, allocation: 50, configId: config, label: "B" },
    ],
  });
  await persistAssignments({ organizationId: org, experimentId, assignments });

  // Simulate identical outcomes (same rate) — if randomization is broken, counts diverge wildly.
  const aCount = assignments.filter((a) => a.armId === armA).length;
  const bCount = assignments.filter((a) => a.armId === armB).length;
  const simRate = 0.02;
  const aSuccess = Math.round(aCount * simRate);
  const bSuccess = Math.round(bCount * simRate);
  const postA = betaPosterior(aSuccess, aCount);
  const postB = betaPosterior(bSuccess, bCount);
  const pBeat = probVariantBeatsControl(postB, postA);

  const clean = pBeat < 0.8 && Math.abs(aCount - bCount) < leadsN * 0.15;
  console.info({
    experimentId,
    aCount,
    bCount,
    aSuccess,
    bSuccess,
    pBeat,
    clean,
    verdict: clean
      ? "PASS — A/A looks balanced; real experiments may proceed"
      : "FAIL — investigate assignment/confounds before real experiments",
  });
  process.exit(clean ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
