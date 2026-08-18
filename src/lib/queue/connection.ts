/**
 * BullMQ Redis connection helpers (Phase 4 / P4.1).
 *
 * Uses the same `REDIS_URL` as the Phase 0 cache helper (`src/lib/cache/redis.ts`).
 * BullMQ defaults to ioredis; workers require `maxRetriesPerRequest: null`.
 *
 * Local: `REDIS_URL=redis://localhost:6379` (Compose Redis 7).
 * Never share Redis across local/staging/prod — see docs/ENVIRONMENTS.md.
 */

import type { ConnectionOptions } from "bullmq";

export type BullMqConnectionMode = "queue" | "worker";

/**
 * Parse `REDIS_URL` into BullMQ / ioredis connection options.
 * Returns null when Redis is not configured.
 */
export function getBullMqConnectionOptions(
  mode: BullMqConnectionMode = "queue",
): ConnectionOptions | null {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const dbPath = parsed.pathname?.replace(/^\//, "");
    const db = dbPath ? Number.parseInt(dbPath, 10) : undefined;

    const opts: ConnectionOptions = {
      host: parsed.hostname || "127.0.0.1",
      port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      ...(Number.isFinite(db) ? { db } : {}),
      // Workers must not fail blocking commands after a retry budget.
      ...(mode === "worker" ? { maxRetriesPerRequest: null } : {}),
    };

    return opts;
  } catch {
    console.error("[queue] invalid REDIS_URL");
    return null;
  }
}

export function isBullMqConfigured(): boolean {
  return getBullMqConnectionOptions("queue") != null;
}
