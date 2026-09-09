import { describe, expect, it } from "vitest";
import { withDevProcessDueLock } from "@/lib/email/dev-process-due-lock";

describe("withDevProcessDueLock", () => {
  it("allows a second call after the first finishes (no cooldown)", async () => {
    const first = await withDevProcessDueLock("org/uid-a", async () => ({
      processed: 1,
      sent: 1,
      failed: 0,
      skipped: 0,
      dueFound: 1,
      pendingCount: 1,
    }));
    expect(first).toEqual({
      ok: true,
      result: {
        processed: 1,
        sent: 1,
        failed: 0,
        skipped: 0,
        dueFound: 1,
        pendingCount: 1,
      },
    });

    const second = await withDevProcessDueLock("org/uid-a", async () => ({
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      dueFound: 0,
      pendingCount: 0,
    }));
    expect(second.ok).toBe(true);
  });

  it("returns busy while a flush is in flight for the same owner", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const inflight = withDevProcessDueLock("org/uid-busy", async () => {
      await gate;
      return { processed: 0, sent: 0, failed: 0, skipped: 0, dueFound: 0, pendingCount: 0 };
    });

    const busy = await withDevProcessDueLock("org/uid-busy", async () => ({
      processed: 1,
      sent: 1,
      failed: 0,
      skipped: 0,
    }));
    expect(busy).toEqual({ ok: false, busy: true });

    release();
    await inflight;
  });

  it("allows a different owner to flush while another is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const inflight = withDevProcessDueLock("org/uid-a", async () => {
      await gate;
      return { processed: 0, sent: 0, failed: 0, skipped: 0, dueFound: 0, pendingCount: 0 };
    });

    const other = await withDevProcessDueLock("org/uid-b", async () => ({
      processed: 1,
      sent: 1,
      failed: 0,
      skipped: 0,
      dueFound: 1,
      pendingCount: 1,
    }));
    expect(other.ok).toBe(true);

    release();
    await inflight;
  });
});
