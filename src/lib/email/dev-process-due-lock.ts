/**
 * In-process mutex for the process-due route.
 * Multiple browser tabs otherwise pile up SMTP handlers on one Node process.
 *
 * Cooldown is per mailbox-owner key so flushing assigned-box hosts in sequence
 * is not blocked after the viewer's own collection was processed.
 */

type ProcessDueResult = {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  dueFound?: number;
};

const GLOBAL_LOCK = "__process_due_global__";
const inflight = new Map<string, Promise<ProcessDueResult>>();
const lastFinishedByKey = new Map<string, number>();
/** Per-owner cooldown so rapid polls do not restack the same SMTP flush. */
const COOLDOWN_MS = 8_000;

export async function withDevProcessDueLock(
  key: string,
  run: () => Promise<ProcessDueResult>,
): Promise<{ ok: true; result: ProcessDueResult } | { ok: false; busy: true }> {
  if (inflight.has(GLOBAL_LOCK) || inflight.has(key)) {
    return { ok: false, busy: true };
  }
  const lastFinishedAt = lastFinishedByKey.get(key) ?? 0;
  if (Date.now() - lastFinishedAt < COOLDOWN_MS) {
    return { ok: false, busy: true };
  }

  const promise = run().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
    if (inflight.get(GLOBAL_LOCK) === promise) inflight.delete(GLOBAL_LOCK);
    lastFinishedByKey.set(key, Date.now());
  });
  inflight.set(key, promise);
  inflight.set(GLOBAL_LOCK, promise);
  const result = await promise;
  return { ok: true, result };
}
