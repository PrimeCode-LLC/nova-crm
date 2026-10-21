/**
 * QA 2.8 — writing a record id that belongs to another workspace answers 409
 * without internals, and never touches the other workspace's row (ROB-06 / PERM-07).
 * Skips when DATABASE_URL is unset.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const guardTenantApi = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platform/tenant-api-guard", () => ({ guardTenantApi }));

import { upsertLeadGraphPostgres } from "@/lib/db/crm-write-postgres";
import { organizationToPrismaRow } from "@/lib/db/dual-write-orgs";
import { getLeadFromPostgres } from "@/lib/db/list-crm-postgres";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";

import { POST } from "./route";

const runDb = isDatabaseConfigured();
const A = "test-org-qa-28-a";
const B = "test-org-qa-28-b";
const now = "2026-10-21T00:00:00.000Z";

async function cleanup() {
  await withRlsBypass(async (tx) => {
    for (const org of [A, B]) {
      await tx.lead.deleteMany({ where: { organizationId: org } });
      await tx.contact.deleteMany({ where: { organizationId: org } });
      await tx.account.deleteMany({ where: { organizationId: org } });
      await tx.pgDocument.deleteMany({ where: { organizationId: org } });
      await tx.organization.deleteMany({ where: { id: org } });
    }
  });
}

describe.skipIf(!runDb)("crm-write with another workspace's id (QA 2.8)", () => {
  beforeAll(async () => {
    await cleanup();
    await withRlsBypass(async (tx) => {
      for (const [id, slug] of [[A, "qa-28-a"], [B, "qa-28-b"]]) {
        await tx.organization.create({
          data: organizationToPrismaRow({
            id: id!, name: id!, slug: slug!, status: "active", planId: "free",
            seatsUsed: 1, settings: {}, createdAt: now, updatedAt: now,
          }),
        });
      }
    });
    await upsertLeadGraphPostgres(B, {
      account: { id: "qa28-a", doc: { name: "B Co", ownerId: "ub", createdAt: now, updatedAt: now } },
      contact: { id: "qa28-c", doc: { firstName: "B", lastName: "C", fullName: "B C", accountId: "qa28-a", ownerId: "ub", createdAt: now, updatedAt: now } },
      lead: {
        id: "qa28-l",
        doc: {
          accountId: "qa28-a", contactId: "qa28-c", companyName: "B Co", contactName: "B C", channel: "cold_email",
          stage: "qualified", temperature: "cold", priority: "medium", ownerId: "ub", touches: 0, isIdle: false,
          createdAt: now, updatedAt: now,
        },
      },
    });
    guardTenantApi.mockResolvedValue({
      ok: true,
      ctx: { session: { uid: "ua", email: "ua@nova.test", organizationId: A, orgRole: "owner" }, role: "owner", adminAuth: null },
    });
  }, 60_000);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectPrisma();
    }
  }, 60_000);

  it("answers 409 and leaves the other workspace's lead unchanged", async () => {
    const res = await POST(
      new Request("http://localhost/api/org/crm-write", {
        method: "POST",
        body: JSON.stringify({ action: "upsert", entity: "lead", id: "qa28-l", doc: { stage: "new" } }),
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "A record with this id already exists." });
    expect((await getLeadFromPostgres(B, "qa28-l"))?.stage).toBe("qualified");
  });
});
