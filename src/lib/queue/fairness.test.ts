import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("@/lib/cache/redis", () => ({
  cacheGet: async (key: string) => store.get(key) ?? null,
  cacheSet: async (key: string, value: string) => {
    store.set(key, value);
    return true;
  },
}));

import {
  JOB_PRIORITY,
  assertTenantFairness,
  tenantJobOptions,
  TENANT_RATE_MAX,
} from "@/lib/queue/fairness";

describe("queue fairness", () => {
  beforeEach(() => {
    store.clear();
  });

  it("stamps interactive vs import priority", () => {
    expect(tenantJobOptions("org_a", JOB_PRIORITY.interactive).priority).toBe(1);
    expect(tenantJobOptions("org_a").priority).toBe(JOB_PRIORITY.import);
  });

  it("allows up to TENANT_RATE_MAX then blocks", async () => {
    for (let i = 0; i < TENANT_RATE_MAX; i++) {
      const r = await assertTenantFairness("nova-import-chunks", "org_noisy");
      expect(r.allowed).toBe(true);
    }
    const blocked = await assertTenantFairness("nova-import-chunks", "org_noisy");
    expect(blocked.allowed).toBe(false);

    const other = await assertTenantFairness("nova-import-chunks", "org_quiet");
    expect(other.allowed).toBe(true);
  });
});
