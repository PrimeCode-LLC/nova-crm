/**
 * QA 2.9 — deleting a company that still has contacts, leads or deals is refused
 * with a clear 409 instead of orphaning them (CRM-05). Skips without DATABASE_URL.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deleteCrmEntityPostgres, upsertCrmEntityPostgres, upsertLeadGraphPostgres } from "@/lib/db/crm-write-postgres";
import { organizationToPrismaRow } from "@/lib/db/dual-write-orgs";
import { getAccountFromPostgres } from "@/lib/db/list-crm-postgres";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";

const runDb = isDatabaseConfigured();
const ORG = "test-org-qa-29-accdel";
const now = "2026-10-21T00:00:00.000Z";

async function cleanup() {
  await withRlsBypass(async (tx) => {
    await tx.deal.deleteMany({ where: { organizationId: ORG } });
    await tx.lead.deleteMany({ where: { organizationId: ORG } });
    await tx.contact.deleteMany({ where: { organizationId: ORG } });
    await tx.account.deleteMany({ where: { organizationId: ORG } });
    await tx.pgDocument.deleteMany({ where: { organizationId: ORG } });
    await tx.organization.deleteMany({ where: { id: ORG } });
  });
}

describe.skipIf(!runDb)("company delete guard (QA 2.9)", () => {
  beforeAll(async () => {
    await cleanup();
    await withRlsBypass((tx) =>
      tx.organization.create({
        data: organizationToPrismaRow({
          id: ORG, name: "QA 2.9", slug: "qa-29-accdel", status: "active", planId: "free",
          seatsUsed: 1, settings: {}, createdAt: now, updatedAt: now,
        }),
      }),
    );
    await upsertLeadGraphPostgres(ORG, {
      account: { id: "qa29-a", doc: { name: "Co", ownerId: "u1", createdAt: now, updatedAt: now } },
      contact: { id: "qa29-c", doc: { firstName: "A", lastName: "B", fullName: "A B", accountId: "qa29-a", ownerId: "u1", createdAt: now, updatedAt: now } },
      lead: {
        id: "qa29-l",
        doc: {
          accountId: "qa29-a", contactId: "qa29-c", companyName: "Co", contactName: "A B", channel: "cold_email",
          stage: "new", temperature: "cold", priority: "medium", ownerId: "u1", touches: 0, isIdle: false,
          createdAt: now, updatedAt: now,
        },
      },
    });
    await upsertCrmEntityPostgres(ORG, "deal", "qa29-d", {
      name: "Deal", leadId: "qa29-l", accountId: "qa29-a", contactId: "qa29-c", stage: "proposal",
      value: 100, currency: "USD", probability: 50, ownerId: "u1", createdAt: now, updatedAt: now,
    });
  }, 60_000);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectPrisma();
    }
  }, 60_000);

  it("refuses while records are attached, then deletes once they are gone (CRM-05)", async () => {
    const blocked = await deleteCrmEntityPostgres(ORG, "account", "qa29-a");
    expect(blocked).toEqual({
      ok: false,
      status: 409,
      error: "This company still has 1 contact, 1 lead, 1 deal. Reassign or delete them first.",
    });
    expect(await getAccountFromPostgres(ORG, "qa29-a")).not.toBeNull();

    for (const [entity, id] of [["deal", "qa29-d"], ["lead", "qa29-l"], ["contact", "qa29-c"]] as const) {
      expect((await deleteCrmEntityPostgres(ORG, entity, id)).ok).toBe(true);
    }
    expect((await deleteCrmEntityPostgres(ORG, "account", "qa29-a")).ok).toBe(true);
    expect(await getAccountFromPostgres(ORG, "qa29-a")).toBeNull();
  });
});
