/**
 * RLS / tenant isolation for dashboard KPI SQL path (mirrors tenant-isolation.rls.test.ts).
 * Skips when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { withOrganizationScope, withRlsBypass } from "@/lib/db/tenant-scope";

const runDb = isDatabaseConfigured();

describe.skipIf(!runDb)("dashboard KPI SQL tenant isolation", () => {
  const orgA = "test-org-a-kpi-sql";
  const orgB = "test-org-b-kpi-sql";
  const now = new Date("2026-09-18T00:00:00.000Z");

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.lead.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
      await tx.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
      await tx.organization.createMany({
        data: [
          {
            id: orgA,
            name: "KPI Org A",
            slug: "test-org-a-kpi-sql",
            status: "active",
            planId: "pro",
            settings: {},
            createdAt: now,
            updatedAt: now,
          },
          {
            id: orgB,
            name: "KPI Org B",
            slug: "test-org-b-kpi-sql",
            status: "active",
            planId: "pro",
            settings: {},
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
      await tx.lead.create({
        data: {
          id: "lead-b-only-kpi",
          organizationId: orgB,
          accountId: "acc-b",
          contactId: "con-b",
          channel: "website_form",
          stage: "new",
          temperature: "cold",
          priority: "medium",
          ownerId: "u-b",
          contactName: "B",
          companyName: "B Co",
          touches: 0,
          isIdle: false,
          payload: {
            organizationId: orgB,
            stage: "new",
            channel: "website_form",
            ownerId: "u-b",
          },
          createdAt: now,
          updatedAt: now,
        },
      });
    });
  });

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.lead.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
      await tx.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    });
    await disconnectPrisma();
  });

  it("org A scoped count does not see org B leads", async () => {
    const countA = await withOrganizationScope(orgA, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ c: bigint }>>`
        SELECT COUNT(*)::bigint AS c FROM leads WHERE organization_id = ${orgA}
      `;
      return Number(rows[0]?.c ?? 0);
    });
    const leaked = await withOrganizationScope(orgA, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ c: bigint }>>`
        SELECT COUNT(*)::bigint AS c FROM leads WHERE organization_id = ${orgB}
      `;
      return Number(rows[0]?.c ?? 0);
    });
    expect(countA).toBe(0);
    expect(leaked).toBe(0);
  });
});
