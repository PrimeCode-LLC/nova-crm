import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateUser, updateUserMetadata, findByEmail, findByUid } = vi.hoisted(
  () => ({
    updateUser: vi.fn(),
    updateUserMetadata: vi.fn(),
    findByEmail: vi.fn(),
    findByUid: vi.fn(),
  }),
);

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({
    users: {
      updateUser,
      updateUserMetadata,
    },
  })),
}));

vi.mock("@/lib/platform/members-server", () => ({
  findMembershipByEmailServer: findByEmail,
  findMembershipForUserServer: findByUid,
}));

vi.mock("@/lib/platform/check-platform-admin", () => ({
  isUserPlatformAdmin: vi.fn(async () => false),
}));

import { resolveClerkIdentity } from "./clerk-identity";

function fakeUser(partial: {
  id?: string;
  externalId?: string | null;
  email?: string;
  publicMetadata?: Record<string, unknown>;
}) {
  const email = partial.email ?? "rep@example.com";
  return {
    id: partial.id ?? "user_clerk_1",
    externalId: partial.externalId ?? null,
    fullName: "Rep User",
    firstName: "Rep",
    lastName: "User",
    primaryEmailAddress: { emailAddress: email },
    emailAddresses: [{ emailAddress: email }],
    publicMetadata: partial.publicMetadata ?? {},
  } as never;
}

describe("resolveClerkIdentity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByEmail.mockResolvedValue(null);
    findByUid.mockResolvedValue(null);
  });

  it("uses externalId membership when present", async () => {
    findByUid.mockResolvedValue({
      uid: "fb_uid_1",
      organizationId: "org_1",
      email: "rep@example.com",
      displayName: "Rep",
      role: "admin",
      status: "active",
      invitedByUid: "owner",
      joinedAt: new Date().toISOString(),
    });

    const session = await resolveClerkIdentity(
      fakeUser({ externalId: "fb_uid_1" }),
    );
    expect(session.uid).toBe("fb_uid_1");
    expect(session.organizationId).toBe("org_1");
    expect(session.orgRole).toBe("admin");
    expect(session.bridged).toBe(true);
    expect(findByEmail).not.toHaveBeenCalled();
  });

  it("bridges by email and syncs Clerk externalId", async () => {
    findByEmail.mockResolvedValue({
      uid: "fb_uid_2",
      organizationId: "org_2",
      email: "rep@example.com",
      displayName: "Rep",
      role: "member",
      status: "active",
      invitedByUid: "owner",
      joinedAt: new Date().toISOString(),
    });

    const session = await resolveClerkIdentity(fakeUser({}));
    expect(session.uid).toBe("fb_uid_2");
    expect(session.organizationId).toBe("org_2");
    expect(session.bridged).toBe(true);
    expect(updateUser).toHaveBeenCalledWith("user_clerk_1", {
      externalId: "fb_uid_2",
    });
    expect(updateUserMetadata).toHaveBeenCalled();
  });

  it("falls back to Clerk id when no membership", async () => {
    const session = await resolveClerkIdentity(fakeUser({}));
    expect(session.uid).toBe("user_clerk_1");
    expect(session.organizationId).toBeUndefined();
    expect(session.bridged).toBe(false);
  });
});
