/**
 * QA 1.7 — a workspace always keeps an active owner, and only owners can
 * change owners (TEAM-06). Real document store + tables; only auth is mocked.
 * Skips when DATABASE_URL is unset.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const guardTenantApi = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platform/tenant-api-guard", () => ({ guardTenantApi }));

import { getAdminDb } from "@/lib/db/document-access/admin";
import { organizationToPrismaRow } from "@/lib/db/dual-write-orgs";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import type { OrgMemberRole } from "@/lib/types";

import { DELETE, PATCH } from "./route";

const runDb = isDatabaseConfigured();
const ORG = "test-org-qa-17-owner";
const now = "2026-10-21T00:00:00.000Z";

function members() {
  return getAdminDb()!.collection(COLLECTIONS.organizations).doc(ORG).collection(ORG_SUBCOLLECTIONS.members);
}

async function seed(rows: [uid: string, role: OrgMemberRole, status?: string][]) {
  const snap = await members().get();
  for (const d of snap.docs) await d.ref.delete();
  for (const [uid, role, status = "active"] of rows) {
    await members().doc(uid).set({
      organizationId: ORG, email: `${uid}@nova.test`, displayName: uid, role, status, joinedAt: now,
    });
  }
}

function as(uid: string, role: OrgMemberRole) {
  guardTenantApi.mockResolvedValue({
    ok: true,
    ctx: { session: { uid, organizationId: ORG, email: `${uid}@nova.test` }, role, adminAuth: null },
  });
}

function patch(body: Record<string, unknown>) {
  return PATCH(new Request("http://localhost/api/org/members", { method: "PATCH", body: JSON.stringify(body) }));
}

async function roleOf(uid: string) {
  return (await members().doc(uid).get()).data()?.role;
}

async function cleanup() {
  await withRlsBypass(async (tx) => {
    await tx.member.deleteMany({ where: { organizationId: ORG } });
    await tx.pgDocument.deleteMany({ where: { organizationId: ORG } });
    await tx.organization.deleteMany({ where: { id: ORG } });
  });
}

describe.skipIf(!runDb)("owner protection on member changes (QA 1.7)", () => {
  beforeEach(async () => {
    await cleanup();
    await withRlsBypass((tx) =>
      tx.organization.create({
        data: organizationToPrismaRow({
          id: ORG, name: "QA 1.7", slug: "qa-17-owner", status: "active", planId: "free",
          seatsUsed: 3, settings: {}, createdAt: now, updatedAt: now,
        }),
      }),
    );
  });

  afterAll(async () => {
    try {
      await cleanup();
      for (const uid of ["o1", "o2", "ad", "mem"]) {
        await getAdminDb()!.collection(COLLECTIONS.users).doc(uid).delete().catch(() => undefined);
      }
    } finally {
      await disconnectPrisma();
    }
  });

  it("the only owner cannot demote themselves (TEAM-06)", async () => {
    await seed([["o1", "owner"], ["mem", "member"]]);
    as("o1", "owner");
    const res = await patch({ uid: "o1", role: "member" });
    expect(res.status).toBe(400);
    expect(await roleOf("o1")).toBe("owner");
  });

  it("the only owner cannot be disabled", async () => {
    await seed([["o1", "owner"], ["o2", "owner", "disabled"]]);
    as("o1", "owner");
    expect((await patch({ uid: "o1", status: "disabled" })).status).toBe(400);
  });

  it("with a second active owner, an owner can step down", async () => {
    await seed([["o1", "owner"], ["o2", "owner"]]);
    as("o1", "owner");
    expect((await patch({ uid: "o1", role: "admin" })).status).toBe(200);
    expect(await roleOf("o1")).toBe("admin");
  });

  it("an admin cannot demote or remove an owner", async () => {
    await seed([["o1", "owner"], ["o2", "owner"], ["ad", "admin"]]);
    as("ad", "admin");
    expect((await patch({ uid: "o1", role: "member" })).status).toBe(403);
    const del = await DELETE(new Request("http://localhost/api/org/members?uid=o2", { method: "DELETE" }));
    expect(del.status).toBe(403);
    expect(await roleOf("o1")).toBe("owner");
    expect(await roleOf("o2")).toBe("owner");
  });

  it("an admin can still change a regular member", async () => {
    await seed([["o1", "owner"], ["ad", "admin"], ["mem", "member"]]);
    as("ad", "admin");
    expect((await patch({ uid: "mem", role: "manager" })).status).toBe(200);
  });
});
