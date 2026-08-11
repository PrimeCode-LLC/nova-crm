import { describe, expect, it } from "vitest";
import {
  isQueueHeavyJobsV1Enabled,
  isQueueImportChunksV1Enabled,
  isQueueWorkerV1Enabled,
} from "@/lib/queue/flags";

describe("queue flags", () => {
  it("defaults off", () => {
    const keys = ["QUEUE_WORKER_V1", "QUEUE_IMPORT_CHUNKS_V1", "QUEUE_HEAVY_JOBS_V1"] as const;
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
    expect(isQueueWorkerV1Enabled()).toBe(false);
    expect(isQueueImportChunksV1Enabled()).toBe(false);
    expect(isQueueHeavyJobsV1Enabled()).toBe(false);
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it("requires master switch for child flags", () => {
    const keys = ["QUEUE_WORKER_V1", "QUEUE_IMPORT_CHUNKS_V1", "QUEUE_HEAVY_JOBS_V1"] as const;
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    process.env.QUEUE_IMPORT_CHUNKS_V1 = "true";
    process.env.QUEUE_HEAVY_JOBS_V1 = "true";
    delete process.env.QUEUE_WORKER_V1;
    expect(isQueueImportChunksV1Enabled()).toBe(false);
    expect(isQueueHeavyJobsV1Enabled()).toBe(false);
    process.env.QUEUE_WORKER_V1 = "true";
    expect(isQueueImportChunksV1Enabled()).toBe(true);
    expect(isQueueHeavyJobsV1Enabled()).toBe(true);
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });
});
