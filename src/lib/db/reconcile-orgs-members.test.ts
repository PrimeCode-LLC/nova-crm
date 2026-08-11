import { describe, expect, it } from "vitest";

import {
  diffMemberFields,
  diffOrganizationFields,
  runOrgsMembersReconcile,
  type OrgsMembersReconcileDeps,
  type PostgresMemberRow,
  type PostgresOrganizationRow,
} from "@/lib/db/reconcile-orgs-members";
import type { Organization, OrganizationMember } from "@/lib/types";

function org(partial: Partial<Organization> & { id: string }): Organization {
  return {
    name: `Org ${partial.id}`,
    slug: partial.id,
    status: "active",
    planId: "pro",
    seatsUsed: 1,
    settings: {},
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    ...partial,
  };
}

function member(
  partial: Partial<OrganizationMember> & { uid: string; organizationId: string },
): OrganizationMember {
  return {
    email: `${partial.uid}@example.com`,
    displayName: partial.uid,
    role: "owner",
    status: "active",
    invitedByUid: "bootstrap",
    joinedAt: "2026-08-11T00:00:00.000Z",
    ...partial,
  };
}

function pgOrg(
  partial: Partial<PostgresOrganizationRow> & { id: string },
): PostgresOrganizationRow {
  return {
    name: `Org ${partial.id}`,
    slug: partial.id,
    status: "active",
    planId: "pro",
    maxUsers: null,
    seatsUsed: 1,
    ownerUid: null,
    primaryEmail: null,
    pendingOwnerEmail: null,
    intakePoolEpoch: 1,
    ...partial,
  };
}

function pgMember(
  partial: Partial<PostgresMemberRow> & { uid: string; organizationId: string },
): PostgresMemberRow {
  return {
    email: `${partial.uid}@example.com`,
    displayName: partial.uid,
    role: "owner",
    status: "active",
    invitedByUid: "bootstrap",
    ...partial,
  };
}

async function* ids(...values: string[]) {
  for (const v of values) yield v;
}

describe("diff helpers (P2.5)", () => {
  it("reports organization scalar drift", () => {
    const diffs = diffOrganizationFields(
      org({ id: "o1", name: "A", seatsUsed: 2 }),
      pgOrg({ id: "o1", name: "B", seatsUsed: 2 }),
    );
    expect(diffs).toEqual([
      {
        entity: "organization",
        id: "o1",
        field: "name",
        firestore: "A",
        postgres: "B",
      },
    ]);
  });

  it("reports member scalar drift", () => {
    const diffs = diffMemberFields(
      member({ organizationId: "o1", uid: "u1", role: "owner" }),
      pgMember({ organizationId: "o1", uid: "u1", role: "admin" }),
    );
    expect(diffs[0]?.field).toBe("role");
  });
});

describe("runOrgsMembersReconcile (P2.5)", () => {
  it("fails closed without DB/Firebase", async () => {
    const deps: OrgsMembersReconcileDeps = {
      isDbReady: () => false,
      isFirebaseReady: () => true,
      listOrganizationIds: async function* () {},
      getOrganization: async () => null,
      listMembers: async () => [],
      countPostgresOrganizations: async () => 0,
      countPostgresMembers: async () => 0,
      getPostgresOrganization: async () => null,
      listPostgresMembers: async () => [],
      listAllPostgresOrganizationIds: async () => [],
      listAllPostgresMemberKeys: async () => [],
    };
    const report = await runOrgsMembersReconcile({}, deps);
    expect(report.clean).toBe(false);
    expect(report.errors[0]).toMatch(/DATABASE_URL/);
  });

  it("is clean when counts and fields match", async () => {
    const deps: OrgsMembersReconcileDeps = {
      isDbReady: () => true,
      isFirebaseReady: () => true,
      listOrganizationIds: () => ids("o1"),
      getOrganization: async (id) => org({ id, seatsUsed: 1 }),
      listMembers: async (organizationId) => [
        member({ organizationId, uid: "u1" }),
      ],
      countPostgresOrganizations: async () => 1,
      countPostgresMembers: async () => 1,
      getPostgresOrganization: async (id) => pgOrg({ id, seatsUsed: 1 }),
      listPostgresMembers: async (organizationId) => [
        pgMember({ organizationId, uid: "u1" }),
      ],
      listAllPostgresOrganizationIds: async () => ["o1"],
      listAllPostgresMemberKeys: async () => ["o1/u1"],
    };
    const report = await runOrgsMembersReconcile({}, deps);
    expect(report.clean).toBe(true);
    expect(report.fieldDiffs).toEqual([]);
    expect(report.firestoreOrganizationCount).toBe(1);
    expect(report.firestoreMemberCount).toBe(1);
  });

  it("flags missing postgres rows and field diffs", async () => {
    const deps: OrgsMembersReconcileDeps = {
      isDbReady: () => true,
      isFirebaseReady: () => true,
      listOrganizationIds: () => ids("o1", "o2"),
      getOrganization: async (id) =>
        org({ id, name: id === "o1" ? "One" : "Two" }),
      listMembers: async (organizationId) =>
        organizationId === "o1"
          ? [member({ organizationId, uid: "u1", role: "owner" })]
          : [],
      countPostgresOrganizations: async () => 1,
      countPostgresMembers: async () => 1,
      getPostgresOrganization: async (id) =>
        id === "o1" ? pgOrg({ id, name: "Wrong" }) : null,
      listPostgresMembers: async (organizationId) =>
        organizationId === "o1"
          ? [pgMember({ organizationId, uid: "u1", role: "admin" })]
          : [],
      listAllPostgresOrganizationIds: async () => ["o1"],
      listAllPostgresMemberKeys: async () => ["o1/u1"],
    };
    const report = await runOrgsMembersReconcile({ sampleLimit: 10 }, deps);
    expect(report.clean).toBe(false);
    expect(report.missingInPostgres.organizations).toContain("o2");
    expect(report.fieldDiffs.some((d) => d.field === "name")).toBe(true);
    expect(report.fieldDiffs.some((d) => d.field === "role")).toBe(true);
  });

  it("flags postgres orphans", async () => {
    const deps: OrgsMembersReconcileDeps = {
      isDbReady: () => true,
      isFirebaseReady: () => true,
      listOrganizationIds: () => ids("o1"),
      getOrganization: async (id) => org({ id }),
      listMembers: async () => [],
      countPostgresOrganizations: async () => 2,
      countPostgresMembers: async () => 1,
      getPostgresOrganization: async (id) => pgOrg({ id }),
      listPostgresMembers: async () => [],
      listAllPostgresOrganizationIds: async () => ["o1", "orphan"],
      listAllPostgresMemberKeys: async () => ["orphan/u9"],
    };
    const report = await runOrgsMembersReconcile({}, deps);
    expect(report.missingInFirestore.organizations).toContain("orphan");
    expect(report.missingInFirestore.members).toContain("orphan/u9");
    expect(report.clean).toBe(false);
  });
});
