/**
 * P2.2 tenant isolation: org A must not read org B's organizations/members rows.
 * Requires Compose Postgres + migrated schema (`npm run db:migrate:deploy`).
 * Skips when DATABASE_URL is unset (unit-only environments without a DB).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { disconnectPrisma, getPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { withOrganizationScope, withRlsBypass } from "@/lib/db/tenant-scope";

const runDb = isDatabaseConfigured();

describe.skipIf(!runDb)("RLS tenant isolation (P2.2)", () => {
  const orgA = "test-org-a-p22";
  const orgB = "test-org-b-p22";
  const now = new Date("2026-08-11T00:00:00.000Z");

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.member.deleteMany({
        where: { organizationId: { in: [orgA, orgB] } },
      });
      await tx.organization.deleteMany({
        where: { id: { in: [orgA, orgB] } },
      });

      await tx.organization.createMany({
        data: [
          {
            id: orgA,
            name: "Org A",
            slug: "test-org-a-p22",
            status: "active",
            planId: "pro",
            settings: {},
            createdAt: now,
            updatedAt: now,
          },
          {
            id: orgB,
            name: "Org B",
            slug: "test-org-b-p22",
            status: "active",
            planId: "pro",
            settings: {},
            createdAt: now,
            updatedAt: now,
          },
        ],
      });

      await tx.member.createMany({
        data: [
          {
            uid: "user-a",
            organizationId: orgA,
            email: "a@example.com",
            displayName: "User A",
            role: "owner",
            status: "active",
            invitedByUid: "owner-bootstrap",
            joinedAt: now,
          },
          {
            uid: "user-b",
            organizationId: orgB,
            email: "b@example.com",
            displayName: "User B",
            role: "owner",
            status: "active",
            invitedByUid: "owner-bootstrap",
            joinedAt: now,
          },
        ],
      });
    });
  });

  afterAll(async () => {
    try {
      await withRlsBypass(async (tx) => {
        await tx.member.deleteMany({
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

  it("scoped to org A cannot read org B organization row", async () => {
    const row = await withOrganizationScope(orgA, (tx) =>
      tx.organization.findUnique({ where: { id: orgB } }),
    );
    expect(row).toBeNull();
  });

  it("scoped to org A cannot list org B members", async () => {
    const members = await withOrganizationScope(orgA, (tx) =>
      tx.member.findMany({ where: { organizationId: orgB } }),
    );
    expect(members).toEqual([]);
  });

  it("scoped to org A only sees its own members even without a WHERE filter", async () => {
    const members = await withOrganizationScope(orgA, (tx) => tx.member.findMany());
    expect(members.map((m) => m.uid)).toEqual(["user-a"]);
    expect(members.every((m) => m.organizationId === orgA)).toBe(true);
  });

  it("scoped to org B cannot read org A member by primary key", async () => {
    const member = await withOrganizationScope(orgB, (tx) =>
      tx.member.findUnique({
        where: { organizationId_uid: { organizationId: orgA, uid: "user-a" } },
      }),
    );
    expect(member).toBeNull();
  });

  it("unscoped queries see no tenant rows (fail closed)", async () => {
    const prisma = getPrisma();
    const orgs = await prisma.organization.findMany({
      where: { id: { in: [orgA, orgB] } },
    });
    const members = await prisma.member.findMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    expect(orgs).toEqual([]);
    expect(members).toEqual([]);
  });
});
