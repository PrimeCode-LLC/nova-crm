import { describe, expect, it } from "vitest";

import {
  isPostgresDualWriteOrgsEnabled,
  POSTGRES_DUAL_WRITE_ORGS_V1_FLAG,
} from "@/lib/db/dual-write-orgs-flags";
import {
  memberToPrismaRow,
  organizationToPrismaRow,
} from "@/lib/db/dual-write-orgs";
import type { Organization, OrganizationMember } from "@/lib/types";

describe("postgres_dual_write_orgs_v1 flag", () => {
  it("exposes stable flag id", () => {
    expect(POSTGRES_DUAL_WRITE_ORGS_V1_FLAG).toBe("postgres_dual_write_orgs_v1");
  });

  it("defaults off", () => {
    const prev = process.env.POSTGRES_DUAL_WRITE_ORGS_V1;
    delete process.env.POSTGRES_DUAL_WRITE_ORGS_V1;
    try {
      expect(isPostgresDualWriteOrgsEnabled()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.POSTGRES_DUAL_WRITE_ORGS_V1;
      else process.env.POSTGRES_DUAL_WRITE_ORGS_V1 = prev;
    }
  });

  it("enables when env is true", () => {
    const prev = process.env.POSTGRES_DUAL_WRITE_ORGS_V1;
    process.env.POSTGRES_DUAL_WRITE_ORGS_V1 = "true";
    try {
      expect(isPostgresDualWriteOrgsEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.POSTGRES_DUAL_WRITE_ORGS_V1;
      else process.env.POSTGRES_DUAL_WRITE_ORGS_V1 = prev;
    }
  });
});

describe("dual-write mappers", () => {
  it("maps organization fields for Prisma upsert", () => {
    const org: Organization = {
      id: "org_1",
      name: "Acme",
      slug: "acme",
      status: "active",
      planId: "pro",
      maxUsers: 10,
      seatsUsed: 2,
      ownerUid: "u1",
      primaryEmail: "a@acme.com",
      settings: { timezone: "UTC" },
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T01:00:00.000Z",
    };
    const row = organizationToPrismaRow(org);
    expect(row.id).toBe("org_1");
    expect(row.slug).toBe("acme");
    expect(row.seatsUsed).toBe(2);
    expect(row.trialEndsAt).toBeNull();
    expect(row.createdAt).toEqual(new Date("2026-08-11T00:00:00.000Z"));
  });

  it("maps member fields for Prisma upsert", () => {
    const member: OrganizationMember = {
      uid: "u1",
      organizationId: "org_1",
      email: "A@Acme.com",
      displayName: "Ada",
      role: "owner",
      status: "active",
      invitedByUid: "owner-bootstrap",
      joinedAt: "2026-08-11T00:00:00.000Z",
    };
    const row = memberToPrismaRow(member);
    expect(row.email).toBe("a@acme.com");
    expect(row.organizationId).toBe("org_1");
    expect(row.disabledAt).toBeNull();
  });
});
