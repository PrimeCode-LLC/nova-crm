import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_CACHE_TTL_SECONDS,
  cacheDel,
  cacheGet,
  cacheGetJson,
  cacheSet,
  cacheSetJson,
  cacheSetJsonWithMeta,
  cacheGetJsonWithMeta,
  cacheSetNx,
  closeRedis,
  getRedis,
  isRedisConfigured,
} from "@/lib/cache/redis";

/**
 * Live Redis round-trips only when CI/local explicitly sets REDIS_URL.
 * Do not default to localhost — that hangs GitHub Actions (no Redis service)
 * while node-redis reconnects on ECONNREFUSED.
 */
const redisUrl = process.env.REDIS_URL?.trim() || null;

async function redisReachable(): Promise<boolean> {
  if (!redisUrl) return false;
  const prev = process.env.REDIS_URL;
  process.env.REDIS_URL = redisUrl;
  try {
    await closeRedis();
    const client = await getRedis();
    if (!client) return false;
    const pong = await client.ping();
    return pong === "PONG";
  } catch {
    return false;
  } finally {
    if (prev === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prev;
    await closeRedis();
  }
}

const canRun = await redisReachable();

describe.skipIf(!canRun)("redis cache helper (live)", () => {
  const prefix = `nova:test:p0.2:${Date.now()}`;

  afterAll(async () => {
    process.env.REDIS_URL = redisUrl!;
    await cacheDel(`${prefix}:str`);
    await cacheDel(`${prefix}:json`);
    await closeRedis();
  });

  it("is configured when REDIS_URL is set", () => {
    process.env.REDIS_URL = redisUrl!;
    expect(isRedisConfigured()).toBe(true);
    expect(DEFAULT_CACHE_TTL_SECONDS).toBe(60);
  });

  it("get/set/del round-trip with ~60s TTL", async () => {
    process.env.REDIS_URL = redisUrl!;
    await closeRedis();

    const key = `${prefix}:str`;
    expect(await cacheSet(key, "hello", DEFAULT_CACHE_TTL_SECONDS)).toBe(true);
    expect(await cacheGet(key)).toBe("hello");

    const client = await getRedis();
    expect(client).not.toBeNull();
    const ttl = await client!.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(DEFAULT_CACHE_TTL_SECONDS);

    expect(await cacheDel(key)).toBe(true);
    expect(await cacheGet(key)).toBeNull();
  });

  it("JSON helpers round-trip", async () => {
    process.env.REDIS_URL = redisUrl!;
    const key = `${prefix}:json`;
    const payload = { openSalesLeads: 12, orgId: "org_test" };

    expect(await cacheSetJson(key, payload, 60)).toBe(true);
    expect(await cacheGetJson<typeof payload>(key)).toEqual(payload);
    expect(await cacheDel(key)).toBe(true);
  });

  it("SET NX and meta envelope round-trip", async () => {
    process.env.REDIS_URL = redisUrl!;
    await closeRedis();

    const lockKey = `${prefix}:lock`;
    expect(await cacheSetNx(lockKey, "a", 60)).toBe(true);
    expect(await cacheSetNx(lockKey, "b", 60)).toBe(false);

    const metaKey = `${prefix}:meta`;
    const inner = { n: 1 };
    expect(
      await cacheSetJsonWithMeta(metaKey, inner, {
        softTtlSeconds: 60,
        hardTtlSeconds: 120,
      }),
    ).toBe(true);
    const entry = await cacheGetJsonWithMeta<typeof inner>(metaKey);
    expect(entry?.value).toEqual(inner);
    expect(typeof entry?.softExpiresAt).toBe("number");

    await cacheDel(lockKey);
    await cacheDel(metaKey);
  });
});

describe("redis cache helper (unconfigured)", () => {
  it("returns null/false when REDIS_URL is missing", async () => {
    const prev = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    await closeRedis();

    expect(isRedisConfigured()).toBe(false);
    expect(await getRedis()).toBeNull();
    expect(await cacheGet("any")).toBeNull();
    expect(await cacheSet("any", "x")).toBe(false);
    expect(await cacheDel("any")).toBe(false);
    expect(await cacheSetNx("any", "x", 10)).toBe(false);
    expect(await cacheGetJsonWithMeta("any")).toBeNull();

    if (prev === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prev;
    await closeRedis();
  });

  it("fails fast when REDIS_URL points at a closed port", async () => {
    const prev = process.env.REDIS_URL;
    // Reserved/documentation port — nothing should listen here in CI.
    process.env.REDIS_URL = "redis://127.0.0.1:9";
    await closeRedis();

    const started = Date.now();
    expect(await getRedis()).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);

    if (prev === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prev;
    await closeRedis();
  });
});
