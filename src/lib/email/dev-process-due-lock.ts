/**
 * In-process mutex for the process-due route (per mailbox-owner key).
 * Only blocks true concurrent overlap for the same owner — no time cooldown
 * (cooldown caused production to return busy forever while mail stayed Scheduled).
 * Different owners may flush in parallel so one mailbox cannot starve another.
 */

import type {
  ScheduledFlushRowResult,
  ScheduledSkipReason,
} from "@/lib/email/scheduled-emails-server";

type ProcessDueResult = {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  dueFound?: number;
  pendingCount?: number;
  claimRefused?: number;
  skipReasons?: Record<ScheduledSkipReason, number>;
  rows?: ScheduledFlushRowResult[];
};

const inflight = new Map<string, Promise<ProcessDueResult>>();

export async function withDevProcessDueLock(
  key: string,
  run: () => Promise<ProcessDueResult>,
): Promise<{ ok: true; result: ProcessDueResult } | { ok: false; busy: true }> {
  if (inflight.has(key)) {
    return { ok: false, busy: true };
  }

  const promise = run().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  const result = await promise;
  return { ok: true, result };
}
