import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getMemberServer,
  findMembershipForUserServer,
  findMembershipByEmailServer,
  getOrganizationServer,
  userGet,
} = vi.hoisted(() => ({
  getMemberServer: vi.fn(),
  findMembershipForUserServer: vi.fn(),
  findMembershipByEmailServer: vi.fn(),
  getOrganizationServer: vi.fn(),
  userGet: vi.fn(),
}));

vi.mock("@/lib/platform/members-server", () => ({
  getMemberServer,
  findMembershipForUserServer,
  findMembershipByEmailServer,
}));

vi.mock("@/lib/platform/organizations-server", () => ({
  getOrganizationServer,
}));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => ({
    collection: () => ({
      doc: () => ({ get: userGet }),
    }),
  }),
}));

vi.mock("@/lib/firestore/collections", () => ({
  COLLECTIONS: { users: "users" },
}));

import { resolveLiveTenantForSession, clearLiveTenantCacheForTests } from "@/lib/auth/resolve-live-tenant";

describe("resolveLiveTenantForSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLiveTenantCacheForTests();
    userGet.mockResolvedValue({ data: () => ({ status: "active" }) });
    getOrganizationServer.mockResolvedValue({ id: "org-1", status: "active" });
    findMembershipByEmailServer.mockResolvedValue(null);
  });

  it("uses the live active membership role", async () => {
    getMemberServer.mockResolvedValue({
      uid: "u-1",
      organizationId: "org-1",
      role: "member",
      status: "active",
    });
    await expect(
      resolveLiveTenantForSession({
        uid: "u-1",
        organizationId: "org-1",
        orgRole: "owner",
      }),
    ).resolves.toMatchObject({
      organizationId: "org-1",
      orgRole: "member",
      membershipPending: false,
    });
  });

  it("fails closed when a stale claimed membership was disabled", async () => {
    getMemberServer.mockResolvedValue({
      uid: "u-1",
      organizationId: "org-1",
      role: "member",
      status: "disabled",
    });
    await expect(
      resolveLiveTenantForSession({
        uid: "u-1",
        organizationId: "org-1",
        orgRole: "member",
      }),
    ).resolves.toEqual({
      membershipPending: false,
      accessDeniedReason: "inactive_membership",
    });
  });

  it("blocks inactive Nova users", async () => {
    userGet.mockResolvedValue({ data: () => ({ status: "inactive" }) });
    await expect(
      resolveLiveTenantForSession({
        uid: "u-1",
        organizationId: "org-1",
        orgRole: "member",
      }),
    ).resolves.toEqual({
      membershipPending: false,
      accessDeniedReason: "inactive_user",
    });
  });

  it("blocks suspended organizations", async () => {
    getMemberServer.mockResolvedValue({
      uid: "u-1",
      organizationId: "org-1",
      role: "member",
      status: "active",
    });
    getOrganizationServer.mockResolvedValue({ id: "org-1", status: "suspended" });
    await expect(
      resolveLiveTenantForSession({
        uid: "u-1",
        organizationId: "org-1",
        orgRole: "member",
      }),
    ).resolves.toEqual({
      membershipPending: false,
      accessDeniedReason: "suspended_organization",
    });
  });

  it("preserves the pending approval state", async () => {
    getMemberServer.mockResolvedValue(null);
    findMembershipForUserServer.mockResolvedValue({
      uid: "u-1",
      organizationId: "org-1",
      role: "member",
      status: "pending",
    });
    await expect(
      resolveLiveTenantForSession({ uid: "u-1" }),
    ).resolves.toEqual({
      organizationId: "org-1",
      orgRole: undefined,
      membershipPending: true,
    });
  });

  it("falls back to email membership when uid misses", async () => {
    getMemberServer.mockResolvedValue(null);
    findMembershipForUserServer.mockResolvedValue(null);
    findMembershipByEmailServer.mockResolvedValue({
      uid: "fb-uid",
      organizationId: "org-1",
      role: "admin",
      status: "active",
    });
    await expect(
      resolveLiveTenantForSession({
        uid: "user_clerk",
        email: "rep@example.com",
      }),
    ).resolves.toMatchObject({
      organizationId: "org-1",
      orgRole: "admin",
      membershipPending: false,
    });
  });
});
