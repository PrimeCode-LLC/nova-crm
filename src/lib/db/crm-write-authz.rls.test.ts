/**
 * QA 1.2 — members may only read/write CRM records in their own scope.
 * Regression for PERM-01 (salesperson editing / claiming colleagues' leads).
 * Skips when DATABASE_URL is unset.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertCrmLeadMutationAllowed } from "@/lib/db/crm-write-authz";
import { viewerCanSeeCrmRecord } from "@/lib/db/crm-record-scope";
import { upsertCrmEntityPostgres, upsertLeadGraphPostgres } from "@/lib/db/crm-write-postgres";
import {
  getAccountFromPostgres,
  getDealFromPostgres,
  getLeadFromPostgres,
} from "@/lib/db/list-crm-postgres";
import { organizationToPrismaRow } from "@/lib/db/dual-write-orgs";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";

const runDb = isDatabaseConfigured();
const ORG = "test-org-qa-12-scope";
const REP = "qa12-rep";
const OTHER = "qa12-other";
const OWNER = "qa12-owner";
const now = "2026-10-21T00:00:00.000Z";

function graph(suffix: string, ownerId: string, accountId = `a-${suffix}`) {
  return {
    account: { id: accountId, doc: { name: `Co ${suffix}`, ownerId, createdAt: now, updatedAt: now } },
    contact: {
      id: `ct-${suffix}`,
      doc: { firstName: "C", lastName: suffix, fullName: `C ${suffix}`, accountId, ownerId, createdAt: now, updatedAt: now },
    },
    lead: {
      id: `l-${suffix}`,
      doc: {
        accountId, contactId: `ct-${suffix}`, companyName: `Co ${suffix}`, contactName: `C ${suffix}`,
        channel: "cold_email", stage: "new", temperature: "cold", priority: "medium",
        ownerId, touches: 0, isIdle: false, createdAt: now, updatedAt: now,
      },
    },
  };
}

async function cleanup() {
  await withRlsBypass(async (tx) => {
    await tx.deal.deleteMany({ where: { organizationId: ORG } });
    await tx.lead.deleteMany({ where: { organizationId: ORG } });
    await tx.contact.deleteMany({ where: { organizationId: ORG } });
    await tx.account.deleteMany({ where: { organizationId: ORG } });
    await tx.organization.deleteMany({ where: { id: ORG } });
  });
}

describe.skipIf(!runDb)("CRM record scope for members (QA 1.2)", () => {
  beforeAll(async () => {
    await cleanup();
    await withRlsBypass((tx) =>
      tx.organization.create({
        data: organizationToPrismaRow({
          id: ORG, name: "QA 1.2", slug: "qa-12-scope", status: "active", planId: "free",
          seatsUsed: 3, settings: {}, createdAt: now, updatedAt: now,
        }),
      }),
    );
    await upsertLeadGraphPostgres(ORG, graph("mine", REP));
    await upsertLeadGraphPostgres(ORG, graph("theirs", OTHER));
    // A colleague's company where the rep also has a lead (shared company).
    await upsertLeadGraphPostgres(ORG, graph("shared-other", OTHER, "a-shared"));
    await upsertLeadGraphPostgres(ORG, graph("shared-mine", REP, "a-shared"));
    await upsertCrmEntityPostgres(ORG, "lead", "l-open", {
      ...graph("open", "").lead.doc, accountId: "a-theirs", contactId: "ct-theirs", ownerId: "",
    });
    await upsertCrmEntityPostgres(ORG, "deal", "d-theirs", {
      title: "Theirs", accountId: "a-theirs", contactId: "ct-theirs", leadId: "l-theirs",
      value: 1000, stage: "proposal", ownerId: OTHER, createdAt: now, updatedAt: now,
    });
    await upsertCrmEntityPostgres(ORG, "deal", "d-mine-lead", {
      title: "Mine via lead", accountId: "a-mine", contactId: "ct-mine", leadId: "l-mine",
      value: 1000, stage: "proposal", ownerId: OTHER, createdAt: now, updatedAt: now,
    });
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectPrisma();
    }
  });

  const asRep = { organizationId: ORG, viewerRole: "member" as const, viewerUid: REP };

  it("blocks editing a colleague's lead (PERM-01)", async () => {
    const r = await assertCrmLeadMutationAllowed({ ...asRep, entity: "lead", id: "l-theirs", action: "patch", patch: { stage: "lost" } });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });

  it("blocks taking ownership of a colleague's lead (PERM-01)", async () => {
    const r = await assertCrmLeadMutationAllowed({ ...asRep, entity: "lead", id: "l-theirs", action: "patch", patch: { ownerId: REP } });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });

  it("blocks overwriting a colleague's lead via upsert", async () => {
    const r = await assertCrmLeadMutationAllowed({ ...asRep, entity: "lead", id: "l-theirs", action: "upsert", patch: { stage: "won" } });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });

  it("allows editing and handing off the rep's own lead", async () => {
    expect((await assertCrmLeadMutationAllowed({ ...asRep, entity: "lead", id: "l-mine", action: "patch", patch: { stage: "contacted" } })).ok).toBe(true);
    expect((await assertCrmLeadMutationAllowed({ ...asRep, entity: "lead", id: "l-mine", action: "patch", patch: { ownerId: OTHER } })).ok).toBe(true);
  });

  it("allows claiming an unassigned lead for yourself only", async () => {
    expect((await assertCrmLeadMutationAllowed({ ...asRep, entity: "lead", id: "l-open", action: "patch", patch: { ownerId: REP } })).ok).toBe(true);
    expect(await assertCrmLeadMutationAllowed({ ...asRep, entity: "lead", id: "l-open", action: "patch", patch: { ownerId: OTHER } })).toMatchObject({ ok: false, status: 404 });
  });

  it("allows creating a new lead", async () => {
    expect((await assertCrmLeadMutationAllowed({ ...asRep, entity: "lead", id: "l-brand-new", action: "upsert", patch: { ownerId: REP } })).ok).toBe(true);
  });

  it("blocks renaming a colleague's company the rep has no lead at", async () => {
    const r = await assertCrmLeadMutationAllowed({ ...asRep, entity: "account", id: "a-theirs", action: "patch", patch: { name: "x" } });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });

  it("allows editing a shared company where the rep has a lead", async () => {
    expect((await assertCrmLeadMutationAllowed({ ...asRep, entity: "account", id: "a-shared", action: "patch", patch: { name: "x" } })).ok).toBe(true);
  });

  it("deals: blocks a colleague's deal, allows one linked to the rep's lead", async () => {
    expect(await assertCrmLeadMutationAllowed({ ...asRep, entity: "deal", id: "d-theirs", action: "patch", patch: { stage: "won" } })).toMatchObject({ ok: false, status: 404 });
    expect((await assertCrmLeadMutationAllowed({ ...asRep, entity: "deal", id: "d-mine-lead", action: "patch", patch: { stage: "won" } })).ok).toBe(true);
  });

  it("members still cannot delete leads; owners keep full access", async () => {
    expect(await assertCrmLeadMutationAllowed({ ...asRep, entity: "lead", id: "l-mine", action: "delete" })).toMatchObject({ ok: false, status: 403 });
    const asOwner = { organizationId: ORG, viewerRole: "owner" as const, viewerUid: OWNER };
    expect((await assertCrmLeadMutationAllowed({ ...asOwner, entity: "lead", id: "l-theirs", action: "patch", patch: { stage: "lost" } })).ok).toBe(true);
    expect((await assertCrmLeadMutationAllowed({ ...asOwner, entity: "account", id: "a-theirs", action: "delete" })).ok).toBe(true);
  });

  it("detail reads follow the same scope", async () => {
    const rep = { organizationId: ORG, uid: REP, orgRole: "member" as const };
    const owner = { organizationId: ORG, uid: OWNER, orgRole: "owner" as const };
    const theirs = (await getLeadFromPostgres(ORG, "l-theirs"))!;
    const mine = (await getLeadFromPostgres(ORG, "l-mine"))!;
    expect(await viewerCanSeeCrmRecord(rep, { entity: "lead", value: theirs })).toBe(false);
    expect(await viewerCanSeeCrmRecord(rep, { entity: "lead", value: mine })).toBe(true);
    expect(await viewerCanSeeCrmRecord(owner, { entity: "lead", value: theirs })).toBe(true);
    expect(await viewerCanSeeCrmRecord(rep, { entity: "account", value: (await getAccountFromPostgres(ORG, "a-shared"))! })).toBe(true);
    expect(await viewerCanSeeCrmRecord(rep, { entity: "deal", value: (await getDealFromPostgres(ORG, "d-theirs"))! })).toBe(false);
  });
});
