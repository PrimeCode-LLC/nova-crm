/**
 * Phase 4 local soak — verify BullMQ enqueue + worker consume.
 *
 *   npx tsx scripts/soak-phase4-queue.ts
 *
 * Requires: Compose Redis, `npm run worker`, QUEUE_* flags in .env.local.
 */
import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { QueueEvents } from "bullmq";
import { getBullMqConnectionOptions } from "../src/lib/queue/connection";
import {
  isQueueHeavyJobsV1Enabled,
  isQueueImportChunksV1Enabled,
  isQueueWorkerV1Enabled,
} from "../src/lib/queue/flags";
import {
  enqueueDashboardSummaryJob,
  enqueueHelloJob,
  enqueueImportChunkJob,
} from "../src/lib/queue/enqueue";
import {
  closeAllQueues,
  getQueue,
  QUEUE_DASHBOARD_SUMMARY,
  QUEUE_HELLO,
  QUEUE_IMPORT_CHUNKS,
} from "../src/lib/queue/queues";

function ok(label: string, detail?: string) {
  console.log(`✓ ${label}${detail ? ` — ${detail}` : ""}`);
}
function fail(label: string, detail?: string): never {
  console.error(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
  process.exit(1);
}

async function waitForNextCompletion(
  queueName: string,
  enqueue: () => Promise<string | null>,
  timeoutMs: number,
): Promise<{ jobId: string; state: "completed" | "failed" }> {
  const connection = getBullMqConnectionOptions("queue");
  if (!connection) fail("REDIS_URL missing for QueueEvents");

  const events = new QueueEvents(queueName, { connection });
  await events.waitUntilReady();

  let expectedId: string | null = null;
  const outcome = new Promise<{ jobId: string; state: "completed" | "failed" }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        void events.close();
        reject(new Error(`timed out waiting for ${queueName} job ${expectedId ?? "?"}`));
      }, timeoutMs);

      const finish = async (jobId: string, state: "completed" | "failed") => {
        if (expectedId && jobId !== expectedId) return;
        if (!expectedId) return;
        clearTimeout(timer);
        await events.close();
        resolve({ jobId, state });
      };

      events.on("completed", ({ jobId }) => {
        void finish(jobId, "completed");
      });
      events.on("failed", ({ jobId }) => {
        void finish(jobId, "failed");
      });
    },
  );

  const jobId = await enqueue();
  if (!jobId) {
    await events.close();
    fail(`enqueue ${queueName}`);
  }
  expectedId = jobId;

  const queue = getQueue(queueName as Parameters<typeof getQueue>[0]);
  const existing = queue ? await queue.getJob(jobId) : null;
  if (existing) {
    const state = await existing.getState();
    if (state === "completed" || state === "failed") {
      await events.close();
      return { jobId, state };
    }
  }

  try {
    return await outcome;
  } catch (err) {
    const job = queue ? await queue.getJob(jobId) : null;
    const state = job ? await job.getState() : "unknown";
    if (state === "completed" || state === "failed") {
      return { jobId, state };
    }
    throw err;
  }
}

async function main() {
  console.log("\n=== Phase 4 queue soak ===\n");

  if (!isQueueWorkerV1Enabled()) fail("QUEUE_WORKER_V1 must be true");
  ok("QUEUE_WORKER_V1");
  if (!isQueueImportChunksV1Enabled()) fail("QUEUE_IMPORT_CHUNKS_V1 must be true");
  ok("QUEUE_IMPORT_CHUNKS_V1");
  if (!isQueueHeavyJobsV1Enabled()) fail("QUEUE_HEAVY_JOBS_V1 must be true");
  ok("QUEUE_HEAVY_JOBS_V1");

  const connection = getBullMqConnectionOptions("queue");
  if (!connection) fail("REDIS_URL not configured");
  ok("REDIS_URL", "configured");

  // 1) Hello — worker must consume
  const hello = await waitForNextCompletion(
    QUEUE_HELLO,
    () => enqueueHelloJob(`soak-${Date.now()}`),
    20_000,
  );
  ok("enqueued + worker completed hello", `${hello.jobId} (${hello.state})`);
  if (hello.state !== "completed") fail("hello job", hello.state);

  // 2) Heavy job enqueue (dashboard dirty drain) — proves cron-style enqueue works
  const dash = await waitForNextCompletion(
    QUEUE_DASHBOARD_SUMMARY,
    () => enqueueDashboardSummaryJob({ mode: "dirty" }),
    60_000,
  );
  ok("enqueued + worker picked dashboard-summary", `${dash.jobId} (${dash.state})`);

  // 3) Import chunk enqueue lands on the import queue (fake ids — apply will fail/claim-miss; we only check enqueue)
  const chunkJobId = await enqueueImportChunkJob({
    organizationId: "soak-org",
    jobId: "soak-job",
    chunkId: `soak-chunk-${Date.now()}`,
  });
  if (!chunkJobId) fail("enqueue import chunk");
  ok("enqueued import chunk", chunkJobId);
  const importQueue = getQueue(QUEUE_IMPORT_CHUNKS);
  const importJob = await importQueue!.getJob(chunkJobId);
  if (!importJob) fail("import job not found on queue");
  ok("import job visible on nova-import-chunks", await importJob.getState());
  // Clean up so soak junk doesn't retry forever
  await importJob.remove().catch(async () => {
    // May already be active/failed — move to remove forcibly
    try {
      await importJob.discard();
    } catch {
      /* ignore */
    }
  });
  ok("cleaned soak import job (no real Firestore chunk)");

  // 4) HTTP cron dispatch (optional — needs CRON_SECRET + running next)
  const secret = process.env.CRON_SECRET?.trim();
  const base =
    process.env.SOAK_BASE_URL?.replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "http://127.0.0.1:3000";

  if (!secret) {
    console.log("⚠ CRON_SECRET unset — skip HTTP /api/cron/queue/dispatch (add to .env.local and restart next)");
  } else {
    const res = await fetch(`${base}/api/cron/queue/dispatch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ job: "dashboard-summary" }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok || !body.queued) {
      fail("HTTP dispatch", `${res.status} ${JSON.stringify(body)}`);
    }
    ok("HTTP POST /api/cron/queue/dispatch queued", String(body.jobId));

    // Legacy AH cron route should also enqueue (not run heavy work)
    const refresh = await fetch(`${base}/api/cron/dashboard-summaries/refresh`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const refreshBody = (await refresh.json()) as Record<string, unknown>;
    if (!refresh.ok || refreshBody.queued !== true) {
      fail(
        "AH refresh should enqueue when QUEUE_HEAVY_JOBS_V1",
        `${refresh.status} ${JSON.stringify(refreshBody)}`,
      );
    }
    ok("GET /api/cron/dashboard-summaries/refresh returned queued:true (no inline heavy drain)");
  }

  await closeAllQueues();
  console.log("\n=== Phase 4 soak passed ===\n");
}

main().catch(async (err) => {
  console.error(err);
  await closeAllQueues().catch(() => undefined);
  process.exit(1);
});
