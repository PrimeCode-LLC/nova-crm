import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_CACHE_TTL_SECONDS,
  cacheDel,
  cacheGet,
  cacheGetJson,
  cacheSet,
  cacheSetJson,
  closeRedis,
  getRedis,
  isRedisConfigured,
} from "@/lib/cache/redis";

const redisUrl = process.env.REDIS_URL?.trim() || "redis://localhost:6379";

async function redisReachable(): Promise<boolean> {
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
  }
}

const canRun = await redisReachable();

describe.skipIf(!canRun)("redis cache helper (live)", () => {
  const prefix = `nova:test:p0.2:${Date.now()}`;

  afterAll(async () => {
    process.env.REDIS_URL = redisUrl;
    await cacheDel(`${prefix}:str`);
    await cacheDel(`${prefix}:json`);
    await closeRedis();
  });

  it("is configured when REDIS_URL is set", () => {
    process.env.REDIS_URL = redisUrl;
    expect(isRedisConfigured()).toBe(true);
    expect(DEFAULT_CACHE_TTL_SECONDS).toBe(60);
  });

  it("get/set/del round-trip with ~60s TTL", async () => {
    process.env.REDIS_URL = redisUrl;
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
    process.env.REDIS_URL = redisUrl;
    const key = `${prefix}:json`;
    const payload = { openSalesLeads: 12, orgId: "org_test" };

    expect(await cacheSetJson(key, payload, 60)).toBe(true);
    expect(await cacheGetJson<typeof payload>(key)).toEqual(payload);
    expect(await cacheDel(key)).toBe(true);
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

    if (prev === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prev;
    await closeRedis();
  });
});
