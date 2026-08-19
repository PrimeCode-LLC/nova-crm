/**
 * Queue flags default on when REDIS_URL is set (P7 — no Cloud Functions fallback).
 * Set `QUEUE_*=false` to disable.
 */

export const QUEUE_WORKER_V1_FLAG = "queue_worker_v1" as const;
export const QUEUE_IMPORT_CHUNKS_V1_FLAG = "queue_import_chunks_v1" as const;
export const QUEUE_HEAVY_JOBS_V1_FLAG = "queue_heavy_jobs_v1" as const;

function queueFlag(name: string): boolean {
  const v = process.env[name];
  if (v === "false") return false;
  if (v === "true") return true;
  return Boolean(process.env.REDIS_URL?.trim());
}

export function isQueueWorkerV1Enabled(): boolean {
  return queueFlag("QUEUE_WORKER_V1");
}

export function isQueueImportChunksV1Enabled(): boolean {
  return isQueueWorkerV1Enabled() && queueFlag("QUEUE_IMPORT_CHUNKS_V1");
}

export function isQueueHeavyJobsV1Enabled(): boolean {
  return isQueueWorkerV1Enabled() && queueFlag("QUEUE_HEAVY_JOBS_V1");
}
