import { describe, expect, it, vi } from "vitest";

import {
  runOrgsMembersBackfill,
  type OrgsMembersEtlDeps,
} from "@/lib/db/etl-orgs-members";
import type { Organization, OrganizationMember } from "@/lib/types";

function org(id: string): Organization {
  return {
    id,
    name: `Org ${id}`,
    slug: id,
    status: "active",
    planId: "pro",
    seatsUsed: 1,
    settings: {},
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
  };
}

function member(orgId: string, uid: string): OrganizationMember {
  return {
    uid,
    organizationId: orgId,
    email: `${uid}@example.com`,
    displayName: uid,
    role: "owner",
    status: "active",
    invitedByUid: "bootstrap",
    joinedAt: "2026-08-11T00:00:00.000Z",
  };
}

async function* ids(...values: string[]) {
  for (const v of values) yield v;
}

describe("runOrgsMembersBackfill (P2.4)", () => {
  it("fails closed when DB or Firebase is missing", async () => {
    const deps: OrgsMembersEtlDeps = {
      isDbReady: () => false,
      isFirebaseReady: () => true,
      listOrganizationIds: async function* () {},
      getOrganization: async () => null,
      listMembers: async () => [],
      upsertOrganization: async () => undefined,
      upsertMember: async () => undefined,
    };
    const stats = await runOrgsMembersBackfill({}, deps);
    expect(stats.errors[0]).toMatch(/DATABASE_URL/);
    expect(stats.organizationsScanned).toBe(0);
  });

  it("dry-run scans without upserting", async () => {
    const upsertOrganization = vi.fn();
    const upsertMember = vi.fn();
    const deps: OrgsMembersEtlDeps = {
      isDbReady: () => true,
      isFirebaseReady: () => true,
      listOrganizationIds: () => ids("org-a", "org-b"),
      getOrganization: async (id) => org(id),
      listMembers: async (orgId) => [member(orgId, "u1")],
      upsertOrganization,
      upsertMember,
    };

    const stats = await runOrgsMembersBackfill({ dryRun: true }, deps);
    expect(stats.dryRun).toBe(true);
    expect(stats.organizationsScanned).toBe(2);
    expect(stats.membersScanned).toBe(2);
    expect(stats.organizationsUpserted).toBe(0);
    expect(stats.membersUpserted).toBe(0);
    expect(upsertOrganization).not.toHaveBeenCalled();
    expect(upsertMember).not.toHaveBeenCalled();
  });

  it("upserts orgs then members idempotently (callable twice)", async () => {
    const upsertOrganization = vi.fn(async () => undefined);
    const upsertMember = vi.fn(async () => undefined);
    const deps: OrgsMembersEtlDeps = {
      isDbReady: () => true,
      isFirebaseReady: () => true,
      listOrganizationIds: () => ids("org-a"),
      getOrganization: async (id) => org(id),
      listMembers: async (orgId) => [
        member(orgId, "u1"),
        member(orgId, "u2"),
      ],
      upsertOrganization,
      upsertMember,
    };

    const first = await runOrgsMembersBackfill({}, deps);
    const second = await runOrgsMembersBackfill({}, deps);

    expect(first.organizationsUpserted).toBe(1);
    expect(first.membersUpserted).toBe(2);
    expect(second.organizationsUpserted).toBe(1);
    expect(second.membersUpserted).toBe(2);
    expect(upsertOrganization).toHaveBeenCalledTimes(2);
    expect(upsertMember).toHaveBeenCalledTimes(4);
  });

  it("respects --limit via list options", async () => {
    const seen: number[] = [];
    const deps: OrgsMembersEtlDeps = {
      isDbReady: () => true,
      isFirebaseReady: () => true,
      listOrganizationIds: async function* (opts) {
        seen.push(opts.limit ?? -1);
        yield "org-a";
      },
      getOrganization: async (id) => org(id),
      listMembers: async () => [],
      upsertOrganization: async () => undefined,
      upsertMember: async () => undefined,
    };
    await runOrgsMembersBackfill({ limit: 5 }, deps);
    expect(seen).toEqual([5]);
  });

  it("records per-entity errors without aborting the run", async () => {
    const deps: OrgsMembersEtlDeps = {
      isDbReady: () => true,
      isFirebaseReady: () => true,
      listOrganizationIds: () => ids("org-ok", "org-bad"),
      getOrganization: async (id) => {
        if (id === "org-bad") throw new Error("boom");
        return org(id);
      },
      listMembers: async () => [member("org-ok", "u1")],
      upsertOrganization: async () => undefined,
      upsertMember: async () => undefined,
    };
    const stats = await runOrgsMembersBackfill({}, deps);
    expect(stats.organizationsUpserted).toBe(1);
    expect(stats.membersUpserted).toBe(1);
    expect(stats.errors.some((e) => e.includes("org-bad"))).toBe(true);
  });
});
