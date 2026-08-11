import { afterAll, describe, expect, it } from "vitest";
import { Queue, Worker } from "bullmq";
import { getBullMqConnectionOptions } from "@/lib/queue/connection";
import { closeAllQueues, QUEUE_HELLO } from "@/lib/queue/queues";
import { enqueueHelloJob } from "@/lib/queue/enqueue";
import { processHelloJob } from "@/worker/processors/hello";

const redisUrl = process.env.REDIS_URL?.trim() || null;

async function redisReachable(): Promise<boolean> {
  if (!redisUrl) return false;
  const prev = process.env.REDIS_URL;
  process.env.REDIS_URL = redisUrl;
  try {
    const connection = getBullMqConnectionOptions("queue");
    if (!connection) return false;
    const q = new Queue(`nova-hello-probe-${Date.now()}`, { connection });
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

describe.skipIf(!canRun)("worker hello job (live Redis)", () => {
  afterAll(async () => {
    await closeAllQueues();
  });

  it("enqueues and consumes a hello job", async () => {
    process.env.REDIS_URL = redisUrl!;
    const connection = getBullMqConnectionOptions("worker");
    expect(connection).not.toBeNull();

    const resultPromise = new Promise<{ echo: string }>((resolve, reject) => {
      const worker = new Worker(QUEUE_HELLO, processHelloJob, {
        connection: connection!,
        concurrency: 1,
      });
      worker.on("completed", async (job, result) => {
        try {
          resolve(result as { echo: string });
        } finally {
          await worker.close();
        }
      });
      worker.on("failed", async (job, err) => {
        await worker.close();
        reject(err);
      });
    });

    const jobId = await enqueueHelloJob("phase4-hello");
    expect(jobId).toBeTruthy();

    const result = await Promise.race([
      resultPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("hello job timed out")), 15_000),
      ),
    ]);
    expect(result.echo).toBe("phase4-hello");
  }, 20_000);
});
