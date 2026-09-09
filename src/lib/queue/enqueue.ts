/**
 * Producer helpers — enqueue jobs with optional per-tenant fairness (P4.5).
 *
 * Note: BullMQ custom `jobId` cannot contain `:`.
 */

import type { JobsOptions } from "bullmq";
import {
  getQueue,
  QUEUE_CONTENT_REMINDERS,
  QUEUE_DASHBOARD_SUMMARY,
  QUEUE_HELLO,
  QUEUE_IMAP_SYNC,
  QUEUE_IMPORT_CHUNKS,
  QUEUE_SCHEDULED_EMAIL,
  QUEUE_SCRAPERS,
} from "@/lib/queue/queues";
import { JOB_PRIORITY, tenantJobOptions } from "@/lib/queue/fairness";

export async function enqueueHelloJob(message = "hello"): Promise<string | null> {
  const queue = getQueue(QUEUE_HELLO);
  if (!queue) return null;
  const job = await queue.add(
    "hello",
    { message, enqueuedAt: new Date().toISOString() },
    { removeOnComplete: true },
  );
  return job.id ?? null;
}

export async function enqueueImportChunkJob(input: {
  organizationId: string;
  jobId: string;
  chunkId: string;
}): Promise<string | null> {
  const queue = getQueue(QUEUE_IMPORT_CHUNKS);
  if (!queue) return null;
  const job = await queue.add("apply-chunk", input, {
    jobId: `import-chunk-${input.chunkId}`,
    ...tenantJobOptions(input.organizationId, JOB_PRIORITY.import),
  });
  return job.id ?? null;
}

export async function enqueueImapSyncJob(): Promise<string | null> {
  const queue = getQueue(QUEUE_IMAP_SYNC);
  if (!queue) return null;
  const job = await queue.add(
    "sync-tick",
    {},
    { jobId: `imap-sync-${Date.now()}`, priority: JOB_PRIORITY.cron },
  );
  return job.id ?? null;
}

export async function enqueueScheduledEmailJob(opts?: {
  /** Wait this many ms before the worker runs the due-send tick. */
  delayMs?: number;
}): Promise<string | null> {
  const queue = getQueue(QUEUE_SCHEDULED_EMAIL);
  if (!queue) return null;
  const delayMs =
    opts?.delayMs != null && Number.isFinite(opts.delayMs)
      ? Math.max(0, Math.floor(opts.delayMs))
      : 0;
  const job = await queue.add(
    "send-tick",
    {},
    {
      jobId: `scheduled-email-${Date.now()}`,
      priority: JOB_PRIORITY.cron,
      ...(delayMs > 0 ? { delay: delayMs } : {}),
    },
  );
  return job.id ?? null;
}

export async function enqueueScrapersJob(input?: {
  organizationId?: string;
  mode?: "due" | "org";
}): Promise<string | null> {
  const queue = getQueue(QUEUE_SCRAPERS);
  if (!queue) return null;
  const mode = input?.mode ?? "due";
  const data = { organizationId: input?.organizationId, mode };
  const opts: JobsOptions = input?.organizationId
    ? tenantJobOptions(
        input.organizationId,
        mode === "org" ? JOB_PRIORITY.interactive : JOB_PRIORITY.cron,
      )
    : { priority: JOB_PRIORITY.cron };
  const job = await queue.add("scrapers-tick", data, {
    jobId:
      mode === "org" && input?.organizationId
        ? `scrapers-org-${input.organizationId}-${Date.now()}`
        : `scrapers-due-${Date.now()}`,
    ...opts,
  });
  return job.id ?? null;
}

export async function enqueueContentRemindersJob(): Promise<string | null> {
  const queue = getQueue(QUEUE_CONTENT_REMINDERS);
  if (!queue) return null;
  const job = await queue.add(
    "reminders-tick",
    {},
    { jobId: `content-reminders-${Date.now()}`, priority: JOB_PRIORITY.cron },
  );
  return job.id ?? null;
}

export async function enqueueDashboardSummaryJob(input?: {
  organizationId?: string;
  mode?: "dirty" | "org";
}): Promise<string | null> {
  const queue = getQueue(QUEUE_DASHBOARD_SUMMARY);
  if (!queue) return null;
  const mode = input?.mode ?? "dirty";
  const opts: JobsOptions = input?.organizationId
    ? tenantJobOptions(
        input.organizationId,
        mode === "org" ? JOB_PRIORITY.interactive : JOB_PRIORITY.cron,
      )
    : { priority: JOB_PRIORITY.cron };
  const job = await queue.add(
    "summary-refresh",
    { organizationId: input?.organizationId, mode },
    {
      jobId:
        mode === "org" && input?.organizationId
          ? `dash-summary-org-${input.organizationId}`
          : `dash-summary-dirty-${Date.now()}`,
      ...opts,
    },
  );
  return job.id ?? null;
}
