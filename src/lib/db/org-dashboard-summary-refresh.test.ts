import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import {
  dealFromPostgresRow,
  recomputeOrgDashboardSummaryPostgres,
  tryAcquireOrgDashboardSummaryCooldown,
} from "@/lib/db/org-dashboard-summary-refresh";
import { orgDashboardSummaryFromRow } from "@/lib/db/org-dashboard-summary-postgres";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import type { Deal as PrismaDeal } from "@/generated/prisma/client";

const runDb = isDatabaseConfigured();

describe("org dashboard summary refresh helpers (P3.2)", () => {
  it("dealFromPostgresRow prefers column values over payload", () => {
    const row = {
      id: "deal_1",
      organizationId: "org_1",
      leadId: "lead_1",
      accountId: "acc_1",
      contactId: "con_1",
      name: "From column",
      stage: "qualification",
      value: 42,
      currency: "USD",
      probability: 50,
      expectedCloseDate: new Date("2026-09-01T00:00:00.000Z"),
      ownerId: "user_1",
      wonAt: null,
      lostAt: null,
      payload: {
        name: "From payload",
        value: 99,
        stage: "won",
      },
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    } as unknown as PrismaDeal;

    const deal = dealFromPostgresRow(row);
    expect(deal.name).toBe("From column");
    expect(deal.value).toBe(42);
    expect(deal.stage).toBe("qualification");
    expect(deal.leadId).toBe("lead_1");
  });

  it("local cooldown blocks a second acquire within the window", async () => {
    const orgId = `cooldown-test-${Date.now()}`;
    const first = await tryAcquireOrgDashboardSummaryCooldown(orgId, 60);
    const second = await tryAcquireOrgDashboardSummaryCooldown(orgId, 60);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});

describe.skipIf(!runDb)("recomputeOrgDashboardSummaryPostgres (P3.2)", () => {
  const orgId = "test-org-p32-summary";
  const leadId = "test-lead-p32";
  const now = new Date("2026-08-11T00:00:00.000Z");

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.orgDashboardSummary.deleteMany({ where: { organizationId: orgId } });
      await tx.deal.deleteMany({ where: { organizationId: orgId } });
      await tx.lead.deleteMany({ where: { organizationId: orgId } });
      await tx.organization.deleteMany({ where: { id: orgId } });

      await tx.organization.create({
        data: {
          id: orgId,
          name: "P32 Org",
          slug: "test-org-p32-summary",
          status: "active",
          planId: "pro",
          settings: { timezone: "UTC" },
          createdAt: now,
          updatedAt: now,
        },
      });

      await tx.lead.create({
        data: {
          id: leadId,
          organizationId: orgId,
          accountId: "acc",
          contactId: "con",
          channel: "email",
          stage: "new",
          temperature: "warm",
          priority: "medium",
          ownerId: "user",
          contactName: "Test",
          companyName: "Co",
          intakeKind: null,
          touches: 0,
          isIdle: true,
          payload: {
            organizationId: orgId,
            channel: "email",
            stage: "new",
            intakeKind: undefined,
            isIdle: true,
            estimatedValue: 100,
          },
          createdAt: now,
          updatedAt: now,
        },
      });
    });
  });

  afterAll(async () => {
    try {
      await withRlsBypass(async (tx) => {
        await tx.orgDashboardSummary.deleteMany({ where: { organizationId: orgId } });
        await tx.lead.deleteMany({ where: { organizationId: orgId } });
        await tx.organization.deleteMany({ where: { id: orgId } });
      });
    } finally {
      await disconnectPrisma();
    }
  });

  it("upserts org_dashboard_summaries from Postgres leads", async () => {
    const result = await recomputeOrgDashboardSummaryPostgres(orgId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.summary.openSalesLeads).toBe(1);
    expect(result.summary.idleSalesLeads).toBe(1);
    expect(result.summary.pipelineByStage.new).toBe(1);

    const row = await withRlsBypass((tx) =>
      tx.orgDashboardSummary.findUnique({ where: { organizationId: orgId } }),
    );
    expect(row).not.toBeNull();
    const parsed = row ? orgDashboardSummaryFromRow(row) : null;
    expect(parsed?.openSalesLeads).toBe(1);
    expect(parsed?.idleSalesLeads).toBe(1);
  });
});
