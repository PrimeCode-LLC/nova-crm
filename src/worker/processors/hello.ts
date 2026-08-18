/**
 * Hello / smoke job processor (P4.2).
 * Proves the worker can dequeue from BullMQ against Compose Redis.
 */

import type { Job } from "bullmq";

export type HelloJobData = {
  message?: string;
  enqueuedAt?: string;
};

export type HelloJobResult = {
  ok: true;
  echo: string;
  processedAt: string;
};

export async function processHelloJob(
  job: Job<HelloJobData>,
): Promise<HelloJobResult> {
  const echo = job.data.message?.trim() || "hello";
  const processedAt = new Date().toISOString();
  console.info("[worker:hello] processed", {
    jobId: job.id,
    echo,
    enqueuedAt: job.data.enqueuedAt ?? null,
    processedAt,
  });
  return { ok: true, echo, processedAt };
}
