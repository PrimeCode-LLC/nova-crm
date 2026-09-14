/**
 * Lead-level experiment assignment (deterministic, confound-safe).
 */

import { createHash, randomUUID } from "node:crypto";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import { isDatabaseConfigured } from "@/lib/db/prisma";

export type ExperimentArmInput = {
  id: string;
  allocation: number;
  isControl?: boolean;
  configId: string;
  label: string;
};

export function pickArmId(
  experimentId: string,
  leadId: string,
  arms: readonly { id: string; allocation: number }[],
): string {
  const total = arms.reduce((s, a) => s + Math.max(0, a.allocation), 0) || 1;
  const hash = createHash("sha1")
    .update(`${experimentId}\0${leadId}`)
    .digest();
  const n = hash.readUInt32BE(0) / 0xffffffff;
  let cursor = 0;
  for (const arm of arms) {
    cursor += Math.max(0, arm.allocation) / total;
    if (n <= cursor) return arm.id;
  }
  return arms[arms.length - 1]!.id;
}

/**
 * Shuffle leads then assign — callers should schedule both arms in one bulk batch
 * so mailbox round-robin spreads across arms.
 */
export function assignLeadsToArms(input: {
  experimentId: string;
  leadIds: string[];
  arms: ExperimentArmInput[];
}): Array<{ leadId: string; armId: string; configId: string }> {
  const shuffled = [...input.leadIds].sort((a, b) =>
    createHash("sha1")
      .update(`${input.experimentId}:shuffle:${a}`)
      .digest("hex")
      .localeCompare(
        createHash("sha1").update(`${input.experimentId}:shuffle:${b}`).digest("hex"),
      ),
  );
  return shuffled.map((leadId) => {
    const armId = pickArmId(input.experimentId, leadId, input.arms);
    const arm = input.arms.find((a) => a.id === armId)!;
    return { leadId, armId, configId: arm.configId };
  });
}

export async function persistAssignments(input: {
  organizationId: string;
  experimentId: string;
  assignments: Array<{ leadId: string; armId: string }>;
}): Promise<{ upserted: number }> {
  if (!isDatabaseConfigured()) return { upserted: 0 };
  let upserted = 0;
  await withOrganizationScope(input.organizationId, async (tx) => {
    for (const a of input.assignments) {
      await tx.experimentAssignment.upsert({
        where: {
          experimentId_leadId: {
            experimentId: input.experimentId,
            leadId: a.leadId,
          },
        },
        create: {
          id: `ea-${randomUUID()}`,
          organizationId: input.organizationId,
          experimentId: input.experimentId,
          armId: a.armId,
          leadId: a.leadId,
        },
        update: { armId: a.armId },
      });
      upserted += 1;
    }
  });
  return { upserted };
}

export const STAGE_MIN_PER_ARM = { 1: 600, 2: 1900 } as const;
