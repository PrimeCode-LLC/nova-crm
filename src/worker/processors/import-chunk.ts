/**
 * Import chunk apply processor (P4.3).
 */

import { DelayedError, type Job } from "bullmq";
import { QUEUE_IMPORT_CHUNKS } from "../../lib/queue/queues";
import {
  assertTenantFairness,
  TENANT_RATE_WINDOW_SECONDS,
} from "../../lib/queue/fairness";

export type ImportChunkJobData = {
  organizationId: string;
  jobId: string;
  chunkId: string;
};

export async function processImportChunkJob(
  job: Job<ImportChunkJobData>,
  token?: string,
): Promise<{ ok: true; chunkId: string }> {
  const fairness = await assertTenantFairness(
    QUEUE_IMPORT_CHUNKS,
    job.data.organizationId,
  );
  if (!fairness.allowed) {
    const delayMs = TENANT_RATE_WINDOW_SECONDS * 1000;
    await job.moveToDelayed(Date.now() + delayMs, token);
    throw new DelayedError();
  }

  const { processProspectImportChunkById } = await import(
    "../../lib/imports/prospect-import-chunk-apply"
  );
  await processProspectImportChunkById(job.data);
  return { ok: true, chunkId: job.data.chunkId };
}
