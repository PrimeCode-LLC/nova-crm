/**
 * Phase 4 queue feature flags.
 * Defaults off → Cloud Functions / App Hosting cron paths remain active.
 */

export const QUEUE_WORKER_V1_FLAG = "queue_worker_v1" as const;
export const QUEUE_IMPORT_CHUNKS_V1_FLAG = "queue_import_chunks_v1" as const;
export const QUEUE_HEAVY_JOBS_V1_FLAG = "queue_heavy_jobs_v1" as const;

function envTrue(name: string): boolean {
  return process.env[name] === "true";
}

/** Master switch — must be on for any BullMQ enqueue path. */
export function isQueueWorkerV1Enabled(): boolean {
  return envTrue("QUEUE_WORKER_V1");
}

/** Import chunks via BullMQ (P4.3). Requires QUEUE_WORKER_V1. */
export function isQueueImportChunksV1Enabled(): boolean {
  return isQueueWorkerV1Enabled() && envTrue("QUEUE_IMPORT_CHUNKS_V1");
}

/** IMAP / scheduled email / scrapers / reminders / dashboard drain (P4.4). */
export function isQueueHeavyJobsV1Enabled(): boolean {
  return isQueueWorkerV1Enabled() && envTrue("QUEUE_HEAVY_JOBS_V1");
}
