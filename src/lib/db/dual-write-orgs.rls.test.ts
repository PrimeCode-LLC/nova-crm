/**
 * P2.3 dual-write upserts land in Postgres and are visible under tenant scope.
 * Skips when DATABASE_URL is unset.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMemberMirror,
  upsertMemberMirror,
  upsertOrganizationMirror,
} from "@/lib/db/dual-write-orgs";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { withOrganizationScope, withRlsBypass } from "@/lib/db/tenant-scope";
import type { Organization, OrganizationMember } from "@/lib/types";

const runDb = isDatabaseConfigured();

describe.skipIf(!runDb)("dual-write org/member upserts (P2.3)", () => {
  const orgId = "test-org-dual-write-p23";
  const uid = "user-dual-write-p23";
  const now = "2026-08-11T00:00:00.000Z";

  const org: Organization = {
    id: orgId,
    name: "Dual Write Org",
    slug: "dual-write-p23",
    status: "active",
    planId: "pro",
    seatsUsed: 1,
    ownerUid: uid,
    primaryEmail: "owner@example.com",
    settings: { timezone: "UTC" },
    createdAt: now,
    updatedAt: now,
  };

  const member: OrganizationMember = {
    uid,
    organizationId: orgId,
    email: "owner@example.com",
    displayName: "Owner",
    role: "owner",
    status: "active",
    invitedByUid: "owner-bootstrap",
    joinedAt: now,
  };

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.member.deleteMany({ where: { organizationId: orgId } });
      await tx.organization.deleteMany({ where: { id: orgId } });
    });
  });

  afterAll(async () => {
    try {
      await withRlsBypass(async (tx) => {
        await tx.member.deleteMany({ where: { organizationId: orgId } });
        await tx.organization.deleteMany({ where: { id: orgId } });
      });
    } finally {
      await disconnectPrisma();
    }
  });

  it("upserts organization then member; tenant scope can read them", async () => {
    await upsertOrganizationMirror(org);
    await upsertMemberMirror(member);

    const scoped = await withOrganizationScope(orgId, async (tx) => {
      const o = await tx.organization.findUnique({ where: { id: orgId } });
      const members = await tx.member.findMany();
      return { o, members };
    });

    expect(scoped.o?.slug).toBe("dual-write-p23");
    expect(scoped.o?.seatsUsed).toBe(1);
    expect(scoped.members).toHaveLength(1);
    expect(scoped.members[0]?.uid).toBe(uid);
  });

  it("updates member role on re-upsert", async () => {
    await upsertMemberMirror({ ...member, role: "admin", displayName: "Admin" });
    const row = await withOrganizationScope(orgId, (tx) =>
      tx.member.findUnique({
        where: { organizationId_uid: { organizationId: orgId, uid } },
      }),
    );
    expect(row?.role).toBe("admin");
    expect(row?.displayName).toBe("Admin");
  });

  it("deletes member mirror", async () => {
    await deleteMemberMirror(orgId, uid);
    const row = await withOrganizationScope(orgId, (tx) =>
      tx.member.findUnique({
        where: { organizationId_uid: { organizationId: orgId, uid } },
      }),
    );
    expect(row).toBeNull();
  });
});
