/**
 * P3.1 tenant isolation: org A must not read org B's dashboard summary row.
 * Requires Compose Postgres + migrated schema (`npm run db:migrate:deploy`).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { disconnectPrisma, getPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { emptyOrgDashboardSummaryRowData } from "@/lib/db/org-dashboard-summary-postgres";
import { withOrganizationScope, withRlsBypass } from "@/lib/db/tenant-scope";

const runDb = isDatabaseConfigured();

describe.skipIf(!runDb)("RLS tenant isolation — org_dashboard_summaries (P3.1)", () => {
  const orgA = "test-org-a-p31";
  const orgB = "test-org-b-p31";
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
            name: "Org A P31",
            slug: "test-org-a-p31",
            status: "active",
            planId: "pro",
            settings: {},
            createdAt: now,
            updatedAt: now,
          },
          {
            id: orgB,
            name: "Org B P31",
            slug: "test-org-b-p31",
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
            openSalesLeads: 11,
          },
          {
            ...emptyOrgDashboardSummaryRowData(orgB, now),
            openSalesLeads: 22,
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

  it("scoped to org A cannot read org B summary", async () => {
    const row = await withOrganizationScope(orgA, (tx) =>
      tx.orgDashboardSummary.findUnique({ where: { organizationId: orgB } }),
    );
    expect(row).toBeNull();
  });

  it("scoped to org A only sees its own summary", async () => {
    const rows = await withOrganizationScope(orgA, (tx) => tx.orgDashboardSummary.findMany());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.organizationId).toBe(orgA);
    expect(rows[0]?.openSalesLeads).toBe(11);
  });

  it("unscoped queries see no summary rows (fail closed)", async () => {
    const prisma = getPrisma();
    const rows = await prisma.orgDashboardSummary.findMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    expect(rows).toEqual([]);
  });
});
