/**
 * Shared BullMQ queue names + producer helpers (Phase 4).
 */

import { Queue, type JobsOptions } from "bullmq";
import { getBullMqConnectionOptions } from "@/lib/queue/connection";

/** Smoke / readiness queue (P4.2 hello job). */
export const QUEUE_HELLO = "nova-hello" as const;

/** Prospect import chunk apply (P4.3). */
export const QUEUE_IMPORT_CHUNKS = "nova-import-chunks" as const;

/** Heavy background ticks (P4.4). */
export const QUEUE_IMAP_SYNC = "nova-imap-sync" as const;
export const QUEUE_SCHEDULED_EMAIL = "nova-scheduled-email" as const;
export const QUEUE_SCRAPERS = "nova-scrapers" as const;
export const QUEUE_CONTENT_REMINDERS = "nova-content-reminders" as const;
export const QUEUE_DASHBOARD_SUMMARY = "nova-dashboard-summary" as const;
export const QUEUE_EVAL_RUN = "nova-eval-run" as const;

export type NovaQueueName =
  | typeof QUEUE_HELLO
  | typeof QUEUE_IMPORT_CHUNKS
  | typeof QUEUE_IMAP_SYNC
  | typeof QUEUE_SCHEDULED_EMAIL
  | typeof QUEUE_SCRAPERS
  | typeof QUEUE_CONTENT_REMINDERS
  | typeof QUEUE_DASHBOARD_SUMMARY
  | typeof QUEUE_EVAL_RUN;

const DEFAULT_JOB_OPTS: JobsOptions = {
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 500 },
  attempts: 3,
  backoff: { type: "exponential", delay: 2_000 },
};

const queues = new Map<string, Queue>();

/**
 * Lazily create (or reuse) a producer Queue for `name`.
 * Returns null when `REDIS_URL` is unset / invalid.
 */
export function getQueue(name: NovaQueueName): Queue | null {
  const connection = getBullMqConnectionOptions("queue");
  if (!connection) return null;

  const existing = queues.get(name);
  if (existing) return existing;

  const queue = new Queue(name, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  });
  queues.set(name, queue);
  return queue;
}

/** Close all cached producer queues (tests / graceful shutdown). */
export async function closeAllQueues(): Promise<void> {
  const open = [...queues.values()];
  queues.clear();
  await Promise.all(
    open.map(async (q) => {
      try {
        await q.close();
      } catch {
        /* ignore */
      }
    }),
  );
}
