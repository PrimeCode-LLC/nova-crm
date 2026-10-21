/**
 * QA 1.8 — CRM rows reached through /api/org/workspace-documents get the same
 * module-permission and record-scope checks as crm-write (PERM-01 / PERM-03
 * bypass). Real document store + tables; only auth is mocked.
 * Skips when DATABASE_URL is unset.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const guardTenantApi = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platform/tenant-api-guard", () => ({ guardTenantApi }));

import { getAdminDb } from "@/lib/db/document-access/admin";
import { upsertLeadGraphPostgres } from "@/lib/db/crm-write-postgres";
import { organizationToPrismaRow } from "@/lib/db/dual-write-orgs";
import { getLeadFromPostgres } from "@/lib/db/list-crm-postgres";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { OrgMemberRole } from "@/lib/types";

import { DELETE, GET, PATCH } from "./route";

const runDb = isDatabaseConfigured();
const ORG = "test-org-qa-18-docpaths";
const REP = "qa18-rep";
const OTHER = "qa18-other";
const CONTENT = "qa18-content";
const OWNER = "qa18-owner";
const now = "2026-10-21T00:00:00.000Z";
const USERS: Record<string, { roleId: string; orgRole: OrgMemberRole }> = {
  [REP]: { roleId: "salesperson", orgRole: "member" },
  [OTHER]: { roleId: "salesperson", orgRole: "member" },
  [CONTENT]: { roleId: "content_team", orgRole: "member" },
  [OWNER]: { roleId: "director", orgRole: "owner" },
};

function as(uid: string) {
  guardTenantApi.mockResolvedValue({
    ok: true,
    ctx: { session: { uid, email: `${uid}@nova.test`, organizationId: ORG, orgRole: USERS[uid]!.orgRole }, role: USERS[uid]!.orgRole, adminAuth: null },
  });
}

function graph(suffix: string, ownerId: string) {
  return {
    account: { id: `qa18-a-${suffix}`, doc: { name: `Co ${suffix}`, ownerId, createdAt: now, updatedAt: now } },
    contact: { id: `qa18-ct-${suffix}`, doc: { firstName: "C", lastName: suffix, fullName: `C ${suffix}`, accountId: `qa18-a-${suffix}`, ownerId, createdAt: now, updatedAt: now } },
    lead: {
      id: `qa18-l-${suffix}`,
      doc: {
        accountId: `qa18-a-${suffix}`, contactId: `qa18-ct-${suffix}`, companyName: `Co ${suffix}`, contactName: `C ${suffix}`,
        channel: "cold_email", stage: "new", temperature: "cold", priority: "medium",
        ownerId, touches: 0, isIdle: false, createdAt: now, updatedAt: now,
      },
    },
  };
}

const getPath = (path: string) =>
  GET(new Request(`http://localhost/api/org/workspace-documents?path=${encodeURIComponent(path)}`));
const getList = (collection: string) =>
  GET(new Request(`http://localhost/api/org/workspace-documents?collection=${collection}&limit=100`));
const patchPath = (path: string, patch: Record<string, unknown>) =>
  PATCH(new Request("http://localhost/api/org/workspace-documents", { method: "PATCH", body: JSON.stringify({ path, patch }) }));

async function cleanup() {
  await withRlsBypass(async (tx) => {
    await tx.lead.deleteMany({ where: { organizationId: ORG } });
    await tx.contact.deleteMany({ where: { organizationId: ORG } });
    await tx.account.deleteMany({ where: { organizationId: ORG } });
    await tx.pgDocument.deleteMany({ where: { organizationId: ORG } });
    await tx.organization.deleteMany({ where: { id: ORG } });
  });
  for (const uid of Object.keys(USERS)) {
    await getAdminDb()!.collection(COLLECTIONS.users).doc(uid).delete().catch(() => undefined);
  }
}

describe.skipIf(!runDb)("CRM paths through workspace-documents (QA 1.8)", () => {
  beforeAll(async () => {
    await cleanup();
    await withRlsBypass((tx) =>
      tx.organization.create({
        data: organizationToPrismaRow({
          id: ORG, name: "QA 1.8", slug: "qa-18-docpaths", status: "active", planId: "free",
          seatsUsed: 4, settings: {}, createdAt: now, updatedAt: now,
        }),
      }),
    );
    for (const [uid, u] of Object.entries(USERS)) {
      await getAdminDb()!.collection(COLLECTIONS.users).doc(uid).set({
        organizationId: ORG, roleId: u.roleId, orgRole: u.orgRole, isSuperAdmin: u.orgRole === "owner",
      });
    }
    await upsertLeadGraphPostgres(ORG, graph("mine", REP));
    await upsertLeadGraphPostgres(ORG, graph("theirs", OTHER));
  }, 60_000); // several DB writes; the default 10 s hook limit flakes under full-suite load

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectPrisma();
    }
  }, 60_000);

  it("a salesperson cannot read or edit a colleague's lead by path", async () => {
    as(REP);
    expect((await getPath("leads/qa18-l-theirs")).status).toBe(404);
    expect((await getPath("accounts/qa18-a-theirs")).status).toBe(404);
    expect((await patchPath("leads/qa18-l-theirs", { stage: "lost" })).status).toBe(404);
    expect((await patchPath("leads/qa18-l-theirs", { ownerId: REP })).status).toBe(404);
    const del = await DELETE(new Request("http://localhost/x", { method: "DELETE", body: JSON.stringify({ path: "leads/qa18-l-theirs" }) }));
    expect(del.status).toBe(403);
    const lead = await getLeadFromPostgres(ORG, "qa18-l-theirs");
    expect(lead).toMatchObject({ stage: "new", ownerId: OTHER });
  });

  it("a salesperson still reads, lists and edits their own lead", async () => {
    as(REP);
    expect((await getPath("leads/qa18-l-mine")).status).toBe(200);
    const list = (await (await getList("leads")).json()) as { docs: { id: string }[] };
    expect(list.docs.map((d) => d.id)).toEqual(["qa18-l-mine"]);
    const accounts = (await (await getList("accounts")).json()) as { docs: { id: string }[] };
    expect(accounts.docs.map((d) => d.id)).toEqual(["qa18-a-mine"]);
    const contacts = (await (await getList("contacts")).json()) as { docs: { id: string }[] };
    expect(contacts.docs.map((d) => d.id)).toEqual(["qa18-ct-mine"]);
    expect((await patchPath("leads/qa18-l-mine", { stage: "contacted" })).status).toBe(200);
    expect((await getLeadFromPostgres(ORG, "qa18-l-mine"))?.stage).toBe("contacted");
  });

  it("a role without the CRM modules gets nothing (PERM-03)", async () => {
    as(CONTENT);
    expect((await getPath("leads/qa18-l-mine")).status).toBe(404);
    const list = (await (await getList("leads")).json()) as { docs: unknown[] };
    expect(list.docs).toEqual([]);
    expect((await patchPath("leads/qa18-l-mine", { stage: "lost" })).status).toBe(403);
  });

  it("the owner sees and edits every lead", async () => {
    as(OWNER);
    expect((await getPath("leads/qa18-l-theirs")).status).toBe(200);
    const list = (await (await getList("leads")).json()) as { docs: { id: string }[] };
    expect(list.docs.map((d) => d.id).sort()).toEqual(["qa18-l-mine", "qa18-l-theirs"]);
    expect((await patchPath("leads/qa18-l-theirs", { priority: "high" })).status).toBe(200);
  });
});
