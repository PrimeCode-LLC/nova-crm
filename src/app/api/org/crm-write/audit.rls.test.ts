/**
 * QA 2.5 — crm-write records lead/deal creation and stage moves server-side,
 * so API, import and job changes show in stage history and activity counters
 * (LEAD-04, DASH-06). Real DB; only auth is mocked. Skips without DATABASE_URL.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const guardTenantApi = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platform/tenant-api-guard", () => ({ guardTenantApi }));

import { getAdminDb } from "@/lib/db/document-access/admin";
import { organizationToPrismaRow } from "@/lib/db/dual-write-orgs";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import { listAuditRecordsInRangeServer } from "@/lib/documents/audit";
import { COLLECTIONS } from "@/lib/documents/collections";

import { POST } from "./route";

const runDb = isDatabaseConfigured();
const ORG = "test-org-qa-25-audit";
const OWNER = "qa25-owner";
const now = "2026-10-21T00:00:00.000Z";

function write(body: Record<string, unknown>) {
  return POST(new Request("http://localhost/api/org/crm-write", { method: "POST", body: JSON.stringify(body) }));
}

async function events() {
  const rows = await listAuditRecordsInRangeServer({ organizationId: ORG });
  return rows.map((r) => ({ event: r.event, meta: r.meta, prev: r.prevValue, next: r.updatedValue }));
}

async function cleanup() {
  await withRlsBypass(async (tx) => {
    await tx.deal.deleteMany({ where: { organizationId: ORG } });
    await tx.lead.deleteMany({ where: { organizationId: ORG } });
    await tx.contact.deleteMany({ where: { organizationId: ORG } });
    await tx.account.deleteMany({ where: { organizationId: ORG } });
    await tx.pgDocument.deleteMany({ where: { organizationId: ORG } });
    await tx.organization.deleteMany({ where: { id: ORG } });
  });
  await getAdminDb()!.collection(COLLECTIONS.users).doc(OWNER).delete().catch(() => undefined);
}

describe.skipIf(!runDb)("crm-write server-side audit (QA 2.5)", () => {
  beforeAll(async () => {
    await cleanup();
    await withRlsBypass((tx) =>
      tx.organization.create({
        data: organizationToPrismaRow({
          id: ORG, name: "QA 2.5", slug: "qa-25-audit", status: "active", planId: "free",
          seatsUsed: 1, settings: {}, createdAt: now, updatedAt: now,
        }),
      }),
    );
    await getAdminDb()!.collection(COLLECTIONS.users).doc(OWNER).set({
      organizationId: ORG, roleId: "director", orgRole: "owner", isSuperAdmin: true,
    });
    guardTenantApi.mockResolvedValue({
      ok: true,
      ctx: { session: { uid: OWNER, email: "owner@nova.test", organizationId: ORG, orgRole: "owner" }, role: "owner", adminAuth: null },
    });
  }, 60_000);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectPrisma();
    }
  }, 60_000);

  it("records creation, stage moves and deal won exactly once each", async () => {
    const graph = {
      action: "upsert_graph",
      account: { id: "qa25-a", doc: { name: "Audit Co", ownerId: OWNER, createdAt: now, updatedAt: now } },
      contact: { id: "qa25-c", doc: { firstName: "Ada", lastName: "Audit", fullName: "Ada Audit", accountId: "qa25-a", ownerId: OWNER, createdAt: now, updatedAt: now } },
      lead: {
        id: "qa25-l",
        doc: {
          accountId: "qa25-a", contactId: "qa25-c", companyName: "Audit Co", contactName: "Ada Audit",
          channel: "cold_email", stage: "new", temperature: "cold", priority: "medium", intakeKind: "prospect",
          ownerId: OWNER, touches: 0, isIdle: false, createdAt: now, updatedAt: now,
        },
      },
    };
    expect((await write(graph)).status).toBe(200);
    // Re-saving the same graph is an update, not a second creation.
    expect((await write(graph)).status).toBe(200);
    expect((await write({ action: "patch", entity: "lead", id: "qa25-l", patch: { stage: "qualified" } })).status).toBe(200);
    expect((await write({ action: "patch", entity: "lead", id: "qa25-l", patch: { priority: "high" } })).status).toBe(200);
    expect(
      (await write({
        action: "upsert", entity: "deal", id: "qa25-d",
        doc: { name: "Audit deal", leadId: "qa25-l", accountId: "qa25-a", contactId: "qa25-c", stage: "proposal", value: 500, currency: "USD", probability: 50, ownerId: OWNER, createdAt: now, updatedAt: now },
      })).status,
    ).toBe(200);
    expect((await write({ action: "patch", entity: "deal", id: "qa25-d", patch: { stage: "won" } })).status).toBe(200);

    const rows = await events();
    const count = (e: string) => rows.filter((r) => r.event === e).length;
    expect(count("lead.created")).toBe(1);
    expect(count("lead.stage_changed")).toBe(1);
    expect(count("deal.created")).toBe(1);
    expect(count("deal.won")).toBe(1);
    const stage = rows.find((r) => r.event === "lead.stage_changed")!;
    expect(stage.meta).toMatchObject({ leadId: "qa25-l", prevStage: "new", nextStage: "qualified" });
    expect(rows.find((r) => r.event === "lead.created")!.meta).toMatchObject({ leadId: "qa25-l", tableName: "prospects" });
  });
});
