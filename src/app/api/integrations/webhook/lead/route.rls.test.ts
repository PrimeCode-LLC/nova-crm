/**
 * QA 2.1 — website-form webhook leads become CRM prospects (CFG-05).
 * Real document store + tables. Skips when DATABASE_URL is unset.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getAdminDb } from "@/lib/db/document-access/admin";
import { organizationToPrismaRow } from "@/lib/db/dual-write-orgs";
import { getLeadFromPostgres } from "@/lib/db/list-crm-postgres";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import { COLLECTIONS } from "@/lib/documents/collections";

import { POST } from "./route";

const runDb = isDatabaseConfigured();
const ORG = "test-org-qa-21-webhook";
const OWNER = "qa21-owner";
const SECRET = "qa21-test-secret";
const now = "2026-10-21T00:00:00.000Z";

function post(body: Record<string, unknown>, secret = SECRET) {
  return POST(
    new Request("http://localhost/api/integrations/webhook/lead", {
      method: "POST",
      headers: { "x-webhook-secret": secret, "content-type": "application/json" },
      body: JSON.stringify({ organizationId: ORG, ...body }),
    }),
  );
}

async function leadsWithEmail(email: string) {
  return withRlsBypass((tx) =>
    tx.lead.count({ where: { organizationId: ORG, payload: { path: ["contactEmail"], equals: email } } }),
  );
}

async function cleanup() {
  await withRlsBypass(async (tx) => {
    await tx.lead.deleteMany({ where: { organizationId: ORG } });
    await tx.contact.deleteMany({ where: { organizationId: ORG } });
    await tx.account.deleteMany({ where: { organizationId: ORG } });
    await tx.pgDocument.deleteMany({ where: { organizationId: ORG } });
    await tx.organization.deleteMany({ where: { id: ORG } });
  });
  await getAdminDb()!.collection(COLLECTIONS.organizations).doc(ORG).delete().catch(() => undefined);
}

describe.skipIf(!runDb)("website lead webhook creates prospects (QA 2.1)", () => {
  beforeAll(async () => {
    await cleanup();
    await withRlsBypass((tx) =>
      tx.organization.create({
        data: organizationToPrismaRow({
          id: ORG, name: "QA 2.1", slug: "qa-21-webhook", status: "active", planId: "free",
          seatsUsed: 1, settings: {}, createdAt: now, updatedAt: now,
        }),
      }),
    );
    await getAdminDb()!.collection(COLLECTIONS.organizations).doc(ORG).set({
      name: "QA 2.1", slug: "qa-21-webhook", status: "active", ownerUid: OWNER,
      settings: { inboundWebhookSecret: SECRET },
    });
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectPrisma();
    }
  });

  it("a website lead becomes a prospect owned by the workspace owner (CFG-05)", async () => {
    const res = await post({
      source: "Contact page", contactEmail: "Jane@Acme-Web.test", contactName: "Jane Doe",
      companyName: "Acme Web", raw: { message: "Need a quote" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { leadId: string; duplicate: boolean; id: string };
    expect(body.duplicate).toBe(false);
    const lead = await getLeadFromPostgres(ORG, body.leadId);
    expect(lead).toMatchObject({
      intakeKind: "prospect", contactEmail: "jane@acme-web.test", companyName: "Acme Web",
      contactName: "Jane Doe", ownerId: OWNER, notes: "Need a quote",
    });
    const queued = (await getAdminDb()!.collection(COLLECTIONS.ingestQueue).doc(body.id).get()).data();
    expect(queued).toMatchObject({ status: "processed", leadId: body.leadId });
  });

  it("re-submitting the same email returns the existing lead", async () => {
    const res = await post({ contactEmail: "jane@acme-web.test", contactName: "Jane D" });
    const body = (await res.json()) as { duplicate: boolean };
    expect(body.duplicate).toBe(true);
    expect(await leadsWithEmail("jane@acme-web.test")).toBe(1);
  });

  it("two simultaneous submissions of a new email create one lead", async () => {
    const [a, b] = await Promise.all([
      post({ contactEmail: "twice@acme-web.test" }),
      post({ contactEmail: "twice@acme-web.test" }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await leadsWithEmail("twice@acme-web.test")).toBe(1);
  });

  it("still rejects a wrong secret and refuses an empty lead", async () => {
    expect((await post({ contactEmail: "x@acme-web.test" }, "wrong")).status).toBe(401);
    expect((await post({ source: "empty" })).status).toBe(422);
  });
});
