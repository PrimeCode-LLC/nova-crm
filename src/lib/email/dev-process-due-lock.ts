/**
 * In-process mutex for the local/dev process-due route.
 * Multiple browser tabs otherwise pile up 10–20s SMTP/gap handlers on one Node process.
 */
const inflight = new Map<string, Promise<{ processed: number; sent: number; failed: number; skipped: number }>>();

export async function withDevProcessDueLock(
  key: string,
  run: () => Promise<{ processed: number; sent: number; failed: number; skipped: number }>,
): Promise<
  | { ok: true; result: { processed: number; sent: number; failed: number; skipped: number } }
  | { ok: false; busy: true }
> {
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
