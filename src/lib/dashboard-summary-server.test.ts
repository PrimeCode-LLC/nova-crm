import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyOpenSalesLeadsDeltaServer } from "@/lib/dashboard-summary-server";

const scheduleRefresh = vi.fn();

vi.mock("@/lib/db/org-dashboard-summary-refresh", () => ({
  scheduleOrgDashboardSummaryRefresh: (...args: unknown[]) => scheduleRefresh(...args),
}));

vi.mock("@/lib/db/prisma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/prisma")>();
  return {
    ...actual,
    isDatabaseConfigured: () => true,
  };
});

describe("applyOpenSalesLeadsDeltaServer", () => {
  beforeEach(() => {
    scheduleRefresh.mockClear();
  });

  it("schedules Postgres refresh on +1 (Firestore writer removed)", async () => {
    const result = await applyOpenSalesLeadsDeltaServer("org_1", 1);
    expect(result).toEqual({ ok: true, openSalesLeads: -1 });
    expect(scheduleRefresh).toHaveBeenCalledWith("org_1");
  });

  it("schedules refresh for decrement deltas", async () => {
    expect(await applyOpenSalesLeadsDeltaServer("org_1", -10)).toEqual({
      ok: true,
      openSalesLeads: -1,
    });
    expect(scheduleRefresh).toHaveBeenCalledWith("org_1");
  });

  it("no-ops on zero delta", async () => {
    expect(await applyOpenSalesLeadsDeltaServer("org_1", 0)).toEqual({
      ok: true,
      openSalesLeads: -1,
    });
    expect(scheduleRefresh).not.toHaveBeenCalled();
  });
});
