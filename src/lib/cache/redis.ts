/**
 * Server-side Redis cache helper (Phase 0 / P0.2).
 *
 * Local: `REDIS_URL=redis://localhost:6379` (Compose Redis 7).
 * Staging/prod: managed Redis URL — never share with local (see docs/ENVIRONMENTS.md).
 *
 * Default TTL matches ENGINEERING_RULES §2 (~60s dashboard freshness).
 * Import only from server code (API routes, server actions, workers) — not client components.
 */

import { createClient, type RedisClientType } from "redis";

/** Default cache TTL for dashboard / KPI reads (seconds). */
export const DEFAULT_CACHE_TTL_SECONDS = 60;

export function getRedisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url || null;
}

export function isRedisConfigured(): boolean {
  return Boolean(getRedisUrl());
}

let client: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType | null> | null = null;

/**
 * Shared Redis client. Returns null when `REDIS_URL` is unset or connect fails
 * (callers should fall back to the uncached path).
 *
 * Connect is fail-fast (no infinite reconnect) so CI / missing Redis cannot hang
 * the process on ECONNREFUSED retries.
 */
export async function getRedis(): Promise<RedisClientType | null> {
  const url = getRedisUrl();
  if (!url) return null;

  if (client?.isOpen) return client;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    let next: RedisClientType | null = null;
    try {
      next = createClient({
        url,
        socket: {
          connectTimeout: 2_000,
          // Do not keep retrying — cache misses should fall back immediately.
          reconnectStrategy: false,
        },
      }) as RedisClientType;
      next.on("error", (err) => {
        // Expected when Redis is down; keep noise low for ops logs.
        console.error("[redis] client error", err instanceof Error ? err.message : err);
      });
      await next.connect();
      client = next;
      return client;
    } catch (err) {
      console.error("[redis] connect failed", err instanceof Error ? err.message : err);
      if (next) {
        try {
          next.removeAllListeners();
          await next.disconnect();
        } catch {
          /* ignore teardown errors */
        }
      }
      client = null;
      return null;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
}

/** Close the shared client (tests / graceful shutdown). */
export async function closeRedis(): Promise<void> {
  connectPromise = null;
  const current = client;
  client = null;
  if (!current) return;
  try {
    current.removeAllListeners();
    if (current.isOpen) {
      await current.quit();
    } else {
      await current.disconnect();
    }
  } catch {
    try {
      current.destroy();
    } catch {
      /* ignore */
    }
  }
}

export async function cacheGet(key: string): Promise<string | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    return await redis.get(key);
  } catch (err) {
    console.error("[redis] GET failed", key, err);
    return null;
  }
}

/**
 * Set a string value with TTL (default {@link DEFAULT_CACHE_TTL_SECONDS}).
 * Returns false when Redis is unavailable or the write fails.
 */
export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds: number = DEFAULT_CACHE_TTL_SECONDS,
): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  const ttl = Math.max(1, Math.floor(ttlSeconds));
  try {
    await redis.set(key, value, { EX: ttl });
    return true;
  } catch (err) {
    console.error("[redis] SET failed", key, err);
    return false;
  }
}

export async function cacheDel(key: string): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  try {
    await redis.del(key);
    return true;
  } catch (err) {
    console.error("[redis] DEL failed", key, err);
    return false;
  }
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const raw = await cacheGet(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSetJson(
  key: string,
  value: unknown,
  ttlSeconds: number = DEFAULT_CACHE_TTL_SECONDS,
): Promise<boolean> {
  return cacheSet(key, JSON.stringify(value), ttlSeconds);
}
