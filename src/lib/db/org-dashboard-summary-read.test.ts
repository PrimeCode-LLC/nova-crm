/**
 * P3.3 — Postgres org dashboard summary read (RLS + Redis cache key).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cache/redis", () => ({
  isRedisConfigured: () => false,
  cacheGetJson: vi.fn(),
  cacheSetJson: vi.fn(),
  cacheDel: vi.fn(),
}));

import { emptyOrgDashboardSummary } from "@/lib/dashboard-summary";
import { emptyOrgDashboardSummaryRowData } from "@/lib/db/org-dashboard-summary-postgres";
import {
  getOrgDashboardSummaryFromPostgres,
  orgDashboardSummaryPostgresCacheKey,
} from "@/lib/db/org-dashboard-summary-read";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { withOrganizationScope, withRlsBypass } from "@/lib/db/tenant-scope";

const runDb = isDatabaseConfigured();

describe("orgDashboardSummaryPostgresCacheKey", () => {
  it("versions the Redis key", () => {
    expect(orgDashboardSummaryPostgresCacheKey("org_a")).toBe("dash:summary:pg:v1:org_a");
  });
});

describe.skipIf(!runDb)("getOrgDashboardSummaryFromPostgres (P3.3)", () => {
  const orgA = "test-org-a-p33";
  const orgB = "test-org-b-p33";
  const now = new Date("2026-08-11T00:00:00.000Z");

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.orgDashboardSummary.deleteMany({
        where: { organizationId: { in: [orgA, orgB] } },
      });
      await tx.organization.deleteMany({
        where: { id: { in: [orgA, orgB] } },
      });

      await tx.organization.createMany({
        data: [
          {
            id: orgA,
            name: "Org A P33",
            slug: "test-org-a-p33",
            status: "active",
            planId: "pro",
            settings: {},
            createdAt: now,
            updatedAt: now,
          },
          {
            id: orgB,
            name: "Org B P33",
            slug: "test-org-b-p33",
            status: "active",
            planId: "pro",
            settings: {},
            createdAt: now,
            updatedAt: now,
          },
        ],
      });

      await tx.orgDashboardSummary.createMany({
        data: [
          {
            ...emptyOrgDashboardSummaryRowData(orgA, now),
            openSalesLeads: 7,
            idleSalesLeads: 2,
          },
          {
            ...emptyOrgDashboardSummaryRowData(orgB, now),
            openSalesLeads: 99,
          },
        ],
      });
    });
  });

  afterAll(async () => {
    try {
      await withRlsBypass(async (tx) => {
        await tx.orgDashboardSummary.deleteMany({
          where: { organizationId: { in: [orgA, orgB] } },
        });
        await tx.organization.deleteMany({
          where: { id: { in: [orgA, orgB] } },
        });
      });
    } finally {
      await disconnectPrisma();
    }
  });

  it("reads the scoped org summary from Postgres", async () => {
    const result = await getOrgDashboardSummaryFromPostgres(orgA);
    expect(result?.source).toBe("postgres");
    expect(result?.summary.openSalesLeads).toBe(7);
    expect(result?.summary.idleSalesLeads).toBe(2);
    expect(result?.summary).toMatchObject(
      expect.objectContaining({
        id: orgA,
        organizationId: orgA,
        version: emptyOrgDashboardSummary(orgA).version,
      }),
    );
  });

  it("does not leak org B when reading via tenant scope", async () => {
    const leaked = await withOrganizationScope(orgA, (tx) =>
      tx.orgDashboardSummary.findUnique({ where: { organizationId: orgB } }),
    );
    expect(leaked).toBeNull();
  });

  it("returns null when row is missing", async () => {
    expect(await getOrgDashboardSummaryFromPostgres("org-missing-p33")).toBeNull();
  });
});
