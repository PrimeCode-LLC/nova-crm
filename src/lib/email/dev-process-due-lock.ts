/**
 * In-process mutex for the local/dev process-due route.
 * Multiple browser tabs otherwise pile up long SMTP handlers on one Node process.
 */

type ProcessDueResult = {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
};

const GLOBAL_LOCK = "__process_due_global__";
const inflight = new Map<string, Promise<ProcessDueResult>>();
/** After a completed run, ignore new starts for this long (ms). */
const COOLDOWN_MS = 60_000;
let lastFinishedAt = 0;

export async function withDevProcessDueLock(
  key: string,
  run: () => Promise<ProcessDueResult>,
): Promise<{ ok: true; result: ProcessDueResult } | { ok: false; busy: true }> {
  if (inflight.has(GLOBAL_LOCK) || inflight.has(key)) {
    return { ok: false, busy: true };
  }
  if (Date.now() - lastFinishedAt < COOLDOWN_MS) {
    return { ok: false, busy: true };
  }

  const promise = run().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
    if (inflight.get(GLOBAL_LOCK) === promise) inflight.delete(GLOBAL_LOCK);
    lastFinishedAt = Date.now();
  });
  inflight.set(key, promise);
  inflight.set(GLOBAL_LOCK, promise);
  const result = await promise;
  return { ok: true, result };
}
