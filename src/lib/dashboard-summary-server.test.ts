import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { applyOpenSalesLeadsDeltaServer } from "@/lib/dashboard-summary-server";

vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: vi.fn() }));
vi.mock("@/lib/cache/redis", () => ({
  isRedisConfigured: () => false,
  cacheDel: vi.fn(),
}));

type Row = Record<string, unknown>;

class FakeDocRef {
  constructor(
    private readonly db: FakeFirestore,
    readonly key: string,
  ) {}

  async get() {
    const data = this.db.rows.get(this.key);
    return {
      exists: data != null,
      data: () => data,
    };
  }
}

class FakeFirestore {
  rows = new Map<string, Row>();

  collection(name: string) {
    return {
      doc: (id: string) => new FakeDocRef(this, `${name}/${id}`),
      where: () => ({
        get: async () => ({ docs: [] as { data: () => Row }[] }),
      }),
    };
  }

  async runTransaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
    const tx = new FakeTx(this);
    return fn(tx);
  }
}

class FakeTx {
  constructor(private readonly db: FakeFirestore) {}

  async get(ref: FakeDocRef) {
    return ref.get();
  }

  set(ref: FakeDocRef, value: Row, _opts?: { merge?: boolean }) {
    const current = this.db.rows.get(ref.key) ?? {};
    this.db.rows.set(ref.key, { ...current, ...value });
  }
}

describe("applyOpenSalesLeadsDeltaServer", () => {
  let db: FakeFirestore;
  const prevFsWriter = process.env.DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1;

  beforeEach(() => {
    db = new FakeFirestore();
    vi.mocked(getAdminDb).mockReturnValue(db as never);
    // P3.4 — Firestore delta path is opt-in rollback only.
    process.env.DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1 = "true";
  });

  afterEach(() => {
    if (prevFsWriter === undefined) delete process.env.DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1;
    else process.env.DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1 = prevFsWriter;
  });

  it("seeds a summary doc on first +1", async () => {
    const result = await applyOpenSalesLeadsDeltaServer("org_1", 1);
    expect(result).toEqual({ ok: true, openSalesLeads: 1 });
    const row = db.rows.get(`${COLLECTIONS.orgDashboardSummaries}/org_1`);
    expect(row?.openSalesLeads).toBe(1);
    expect(row?.organizationId).toBe("org_1");
    expect(row?.version).toBe(1);
  });

  it("increments and clamps at zero", async () => {
    db.rows.set(`${COLLECTIONS.orgDashboardSummaries}/org_1`, {
      id: "org_1",
      organizationId: "org_1",
      version: 1,
      openSalesLeads: 2,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(await applyOpenSalesLeadsDeltaServer("org_1", 1)).toEqual({
      ok: true,
      openSalesLeads: 3,
    });
    expect(await applyOpenSalesLeadsDeltaServer("org_1", -10)).toEqual({
      ok: true,
      openSalesLeads: 0,
    });
  });

  it("no-ops on zero delta", async () => {
    expect(await applyOpenSalesLeadsDeltaServer("org_1", 0)).toEqual({
      ok: true,
      openSalesLeads: -1,
    });
    expect(db.rows.size).toBe(0);
  });
});
