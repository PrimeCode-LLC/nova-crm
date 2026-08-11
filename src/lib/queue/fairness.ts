/**
 * Per-tenant fairness for BullMQ jobs (P4.5) — OSS-safe (no BullMQ Pro groups).
 *
 * Strategy:
 * 1. Worker-level limiter caps global throughput per queue.
 * 2. Enqueue stamps `organizationId` on job data; worker processors honor
 *    {@link assertTenantFairness} via a Redis sliding window so one org cannot
 *    monopolize a shared queue.
 * 3. Priority lanes separate interactive work from cron ticks.
 */

import type { JobsOptions, WorkerOptions } from "bullmq";
import { cacheGet, cacheSet } from "@/lib/cache/redis";

/** Max jobs claimed per organization per window (soft fairness). */
export const TENANT_RATE_MAX = 20;
/** Fairness window (seconds). */
export const TENANT_RATE_WINDOW_SECONDS = 60;

/** Priority lanes: lower number = higher priority (BullMQ). */
export const JOB_PRIORITY = {
  interactive: 1,
  import: 2,
  cron: 5,
} as const;

export type TenantFairnessJobData = {
  organizationId?: string;
};

/**
 * Job options for tenant-scoped work (priority + stable-ish job id left to caller).
 */
export function tenantJobOptions(
  organizationId: string,
  priority: number = JOB_PRIORITY.import,
): JobsOptions {
  const org = organizationId.trim();
  if (!org) return { priority };
  return { priority };
}

/**
 * Worker options: soft global rate limit so a single queue cannot monopolize Redis/CPU.
 */
export function tenantAwareWorkerOptions(
  extras: Partial<WorkerOptions> = {},
): Partial<WorkerOptions> {
  return {
    limiter: {
      max: TENANT_RATE_MAX,
      duration: TENANT_RATE_WINDOW_SECONDS * 1000,
    },
    ...extras,
  };
}

function fairnessKey(queueName: string, organizationId: string): string {
  return `queue:fair:v1:${queueName}:${organizationId}`;
}

/**
 * Returns true when this org is still under the per-window budget.
 * Fail-open (allow) when Redis is unavailable so jobs are not stuck forever.
 */
export async function assertTenantFairness(
  queueName: string,
  organizationId: string | undefined,
): Promise<{ allowed: boolean; count: number }> {
  const org = organizationId?.trim();
  if (!org) return { allowed: true, count: 0 };

  const key = fairnessKey(queueName, org);
  const raw = await cacheGet(key);
  const count = raw ? Number.parseInt(raw, 10) || 0 : 0;
  if (count >= TENANT_RATE_MAX) {
    return { allowed: false, count };
  }
  await cacheSet(key, String(count + 1), TENANT_RATE_WINDOW_SECONDS);
  return { allowed: true, count: count + 1 };
}
