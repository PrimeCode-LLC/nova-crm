import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { emptyOrgDashboardSummary } from "@/lib/dashboard-summary";
import { getOrgDashboardSummaryServer } from "@/lib/dashboard-summary-server";

vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: vi.fn() }));
vi.mock("@/lib/cache/redis", () => ({
  DEFAULT_CACHE_TTL_SECONDS: 60,
  isRedisConfigured: () => false,
  cacheDel: vi.fn(),
  cacheGetJson: vi.fn(),
  cacheSetJson: vi.fn(),
}));

class FakeDocRef {
  constructor(
    private readonly db: FakeFirestore,
    readonly key: string,
  ) {}

  async get() {
    const data = this.db.rows.get(this.key);
    return { exists: data != null, data: () => data };
  }
}

class FakeFirestore {
  rows = new Map<string, Record<string, unknown>>();
  collection(name: string) {
    return { doc: (id: string) => new FakeDocRef(this, `${name}/${id}`) };
  }
}

describe("getOrgDashboardSummaryServer", () => {
  let db: FakeFirestore;

  beforeEach(() => {
    db = new FakeFirestore();
    vi.mocked(getAdminDb).mockReturnValue(db as never);
  });

  it("returns null when summary doc is missing", async () => {
    expect(await getOrgDashboardSummaryServer("org_1")).toBeNull();
  });

  it("returns parsed summary from Firestore", async () => {
    const summary = emptyOrgDashboardSummary("org_1", "2026-08-11T00:00:00.000Z");
    summary.openSalesLeads = 9;
    db.rows.set(`${COLLECTIONS.orgDashboardSummaries}/org_1`, summary);
    const result = await getOrgDashboardSummaryServer("org_1");
    expect(result?.source).toBe("firestore");
    expect(result?.summary.openSalesLeads).toBe(9);
  });
});
