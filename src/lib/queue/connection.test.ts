import { afterAll, describe, expect, it } from "vitest";
import { Queue } from "bullmq";
import {
  getBullMqConnectionOptions,
  isBullMqConfigured,
} from "@/lib/queue/connection";
import { closeAllQueues, getQueue, QUEUE_HELLO } from "@/lib/queue/queues";

describe("bullmq connection options", () => {
  it("returns null when REDIS_URL is missing", () => {
    const prev = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    expect(getBullMqConnectionOptions()).toBeNull();
    expect(isBullMqConfigured()).toBe(false);
    if (prev === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prev;
  });

  it("parses host/port/db from REDIS_URL", () => {
    const prev = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://:secret@127.0.0.1:6380/2";
    const opts = getBullMqConnectionOptions("queue");
    expect(opts).toMatchObject({
      host: "127.0.0.1",
      port: 6380,
      password: "secret",
      db: 2,
    });
    expect(opts).not.toHaveProperty("maxRetriesPerRequest");
    const workerOpts = getBullMqConnectionOptions("worker");
    expect(workerOpts).toMatchObject({ maxRetriesPerRequest: null });
    if (prev === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prev;
  });
});

const redisUrl = process.env.REDIS_URL?.trim() || null;

async function redisReachable(): Promise<boolean> {
  if (!redisUrl) return false;
  const prev = process.env.REDIS_URL;
  process.env.REDIS_URL = redisUrl;
  try {
    const connection = getBullMqConnectionOptions("queue");
    if (!connection) return false;
    const q = new Queue(`nova-conn-probe-${Date.now()}`, { connection });
    await q.waitUntilReady();
    await q.close();
    return true;
  } catch {
    return false;
  } finally {
    if (prev === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prev;
  }
}

const canRun = await redisReachable();

describe.skipIf(!canRun)("bullmq connection (live Redis)", () => {
  afterAll(async () => {
    await closeAllQueues();
  });

  it("opens a Queue against REDIS_URL", async () => {
    process.env.REDIS_URL = redisUrl!;
    const queue = getQueue(QUEUE_HELLO);
    expect(queue).not.toBeNull();
    await queue!.waitUntilReady();
    const counts = await queue!.getJobCounts("waiting", "completed");
    expect(counts).toBeDefined();
  });
});
