/**
 * Resolve active experiment arm config for a lead (if any running experiment).
 */

import { withOrganizationScope } from "@/lib/db/tenant-scope";
import { isDatabaseConfigured } from "@/lib/db/prisma";

export type LeadExperimentAssignment = {
  experimentId: string;
  armId: string;
  configId: string;
  label: string;
  isControl: boolean;
};

/**
 * Look up the lead's assignment on the newest *running* experiment that includes them.
 * Returns null when no assignment exists, or when experiment lookup fails (non-fatal for AI).
 */
export async function resolveLeadExperimentAssignment(
  organizationId: string,
  leadId: string,
): Promise<LeadExperimentAssignment | null> {
  if (!isDatabaseConfigured()) return null;
  const lid = leadId.trim();
  if (!lid) return null;

  try {
    return await withOrganizationScope(organizationId, async (tx) => {
      if (!("experimentAssignment" in tx) || typeof tx.experimentAssignment?.findMany !== "function") {
        return null;
      }

      const assignments = await tx.experimentAssignment.findMany({
        where: { organizationId, leadId: lid },
        orderBy: { assignedAt: "desc" },
        take: 20,
      });
      if (assignments.length === 0) return null;

      for (const assignment of assignments) {
        const experiment = await tx.experiment.findFirst({
          where: {
            id: assignment.experimentId,
            organizationId,
            status: "running",
          },
        });
        if (!experiment) continue;

        const arm = await tx.experimentArm.findFirst({
          where: {
            id: assignment.armId,
            organizationId,
            experimentId: assignment.experimentId,
          },
        });
        if (!arm) continue;

        return {
          experimentId: experiment.id,
          armId: arm.id,
          configId: arm.configId,
          label: arm.label,
          isControl: arm.isControl,
        };
      }
      return null;
    });
  } catch (err) {
    console.warn(
      "[experiment-resolve] lookup failed; continuing without experiment arm",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export {
  interleaveLeadIdsForExperiment,
  reorderByExperimentShuffle,
} from "@/lib/ai/eval/experiment-shuffle";
