import type { Job } from "bullmq";
import type { OrgScopedJobData } from "@/worker/processors/heavy-jobs";

export async function processEvalRunJob(
  job: Job<OrgScopedJobData & { configId?: string; datasetKey?: string; userId?: string }>,
): Promise<{ ok: true }> {
  const organizationId = job.data.organizationId?.trim();
  const configId = job.data.configId?.trim();
  if (!organizationId || !configId) {
    console.warn("[eval-run] missing organizationId/configId", job.data);
    return { ok: true };
  }
  const { runOfflineEvalServer } = await import("@/lib/ai/eval/run-eval-server");
  const result = await runOfflineEvalServer({
    organizationId,
    configId,
    datasetKey: job.data.datasetKey,
    userId: job.data.userId,
  });
  if (!result.ok) {
    console.warn("[eval-run] failed", result.error);
  }

  // Also refresh scorecards periodically when job name is scorecard-tick
  if (job.name === "scorecard-tick") {
    const { refreshAllOutreachScorecards } = await import("@/lib/ai/eval/scorecard-server");
    await refreshAllOutreachScorecards();
  }

  return { ok: true };
}
