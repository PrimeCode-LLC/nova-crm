/**
 * Nova CRM worker tier entrypoint (Phase 4).
 *
 * Consumes BullMQ queues on REDIS_URL. Built to `dist/worker/index.mjs`
 * via `npm run build:worker` (Dockerfile.worker).
 *
 * Local: `npm run worker` (tsx) or `npm run worker:built` after build.
 */

import { config as loadEnv } from "dotenv";

// Local/dev only — production Compose injects env; do not require .env files in the image.
if (process.env.NODE_ENV !== "production") {
  loadEnv();
  loadEnv({ path: ".env.local", override: true });
}

import { createServer } from "node:http";
import { Worker, type Processor } from "bullmq";
import { getBullMqConnectionOptions } from "../lib/queue/connection";
import { tenantAwareWorkerOptions } from "../lib/queue/fairness";
import {
  QUEUE_CONTENT_REMINDERS,
  QUEUE_DASHBOARD_SUMMARY,
  QUEUE_HELLO,
  QUEUE_IMAP_SYNC,
  QUEUE_IMPORT_CHUNKS,
  QUEUE_SCHEDULED_EMAIL,
  QUEUE_SCRAPERS,
  type NovaQueueName,
} from "../lib/queue/queues";
import { processHelloJob } from "./processors/hello";
import { processImportChunkJob } from "./processors/import-chunk";
import {
  processContentRemindersJob,
  processDashboardSummaryJob,
  processImapSyncJob,
  processScheduledEmailJob,
  processScrapersJob,
} from "./processors/heavy-jobs";

type WorkerRegistration = {
  name: NovaQueueName;
  processor: Processor;
  concurrency?: number;
  /** Apply global + tenant-aware limiter (P4.5). */
  fair?: boolean;
};

function startHealthServer(port: number): ReturnType<typeof createServer> | null {
  const server = createServer((req, res) => {
    if (req.url === "/healthz" || req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, role: "worker" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.warn(
        `[worker] health port :${port} in use — continuing without /healthz (set WORKER_HEALTH_PORT or stop the other process)`,
      );
      return;
    }
    console.error("[worker] health server error", err);
  });
  server.listen(port, "0.0.0.0", () => {
    console.info(`[worker] health listening on :${port}`);
  });
  return server;
}

async function main(): Promise<void> {
  const connection = getBullMqConnectionOptions("worker");
  if (!connection) {
    console.error("[worker] REDIS_URL is required");
    process.exit(1);
  }

  const healthPort = Number.parseInt(process.env.WORKER_HEALTH_PORT || "8081", 10);
  const healthServer =
    Number.isFinite(healthPort) && healthPort > 0
      ? startHealthServer(healthPort)
      : null;

  const registrations: WorkerRegistration[] = [
    { name: QUEUE_HELLO, processor: processHelloJob, concurrency: 4 },
    {
      name: QUEUE_IMPORT_CHUNKS,
      processor: processImportChunkJob,
      concurrency: 2,
      fair: true,
    },
    { name: QUEUE_IMAP_SYNC, processor: processImapSyncJob, concurrency: 1 },
    {
      name: QUEUE_SCHEDULED_EMAIL,
      processor: processScheduledEmailJob,
      concurrency: 1,
    },
    {
      name: QUEUE_SCRAPERS,
      processor: processScrapersJob,
      concurrency: 1,
      fair: true,
    },
    {
      name: QUEUE_CONTENT_REMINDERS,
      processor: processContentRemindersJob,
      concurrency: 1,
    },
    {
      name: QUEUE_DASHBOARD_SUMMARY,
      processor: processDashboardSummaryJob,
      concurrency: 2,
      fair: true,
    },
  ];

  const workers = registrations.map((reg) => {
    const fairOpts = reg.fair ? tenantAwareWorkerOptions() : {};
    return new Worker(reg.name, reg.processor, {
      connection,
      concurrency: reg.concurrency ?? 1,
      ...fairOpts,
    });
  });

  for (const w of workers) {
    w.on("failed", (job, err) => {
      console.error(`[worker:${w.name}] failed`, {
        jobId: job?.id,
        err: err.message,
      });
    });
    w.on("completed", (job) => {
      console.info(`[worker:${w.name}] completed`, { jobId: job.id });
    });
  }

  console.info(
    "[worker] listening",
    registrations.map((r) => r.name).join(", "),
  );

  const shutdown = async (signal: string) => {
    console.info(`[worker] shutting down (${signal})`);
    await Promise.all(workers.map((w) => w.close()));
    await new Promise<void>((resolve) => {
      if (!healthServer) {
        resolve();
        return;
      }
      healthServer.close(() => resolve());
    });
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
