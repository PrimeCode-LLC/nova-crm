/**
 * QA 2.4 — signed-in users without a workspace are sent to onboarding, and
 * pending members to /join/pending (AUTH-05, AUTH-03).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  findMembershipForUserServer: vi.fn(),
  isUserPlatformAdmin: vi.fn(),
  mode: undefined as string | undefined,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "nova_workspace_mode" && m.mode ? { value: m.mode } : undefined) }),
}));
vi.mock("@/lib/auth/server", () => ({ requireSession: m.requireSession }));
vi.mock("@/lib/auth/flags", () => ({ isAuthDisabled: () => false }));
vi.mock("@/lib/platform/members-server", () => ({ findMembershipForUserServer: m.findMembershipForUserServer }));
vi.mock("@/lib/platform/check-platform-admin", () => ({ isUserPlatformAdmin: m.isUserPlatformAdmin }));
vi.mock("@/lib/platform/organizations-server", () => ({ getOrganizationServer: async () => null }));

import AppLayout from "./layout";

async function outcome(): Promise<string> {
  try {
    await AppLayout({ children: null });
    return "render";
  } catch (e) {
    return (e as Error).message;
  }
}

describe("app layout workspace redirects (QA 2.4)", () => {
  beforeEach(() => {
    m.mode = undefined;
    m.requireSession.mockResolvedValue({ uid: "u1", email: "u1@nova.test", organizationId: "" });
    m.findMembershipForUserServer.mockResolvedValue(null);
    m.isUserPlatformAdmin.mockResolvedValue(false);
  });

  it("no workspace → onboarding (AUTH-05)", async () => {
    expect(await outcome()).toBe("REDIRECT:/onboarding");
  });

  it("pending membership → /join/pending", async () => {
    m.findMembershipForUserServer.mockResolvedValue({ status: "pending", organizationId: "o1" });
    expect(await outcome()).toBe("REDIRECT:/join/pending");
  });

  it("active member renders the app", async () => {
    m.requireSession.mockResolvedValue({ uid: "u1", email: "u1@nova.test", organizationId: "o1" });
    m.findMembershipForUserServer.mockResolvedValue({ status: "active", organizationId: "o1" });
    expect(await outcome()).toBe("render");
  });

  it("platform admins and demo mode keep the app shell", async () => {
    m.isUserPlatformAdmin.mockResolvedValue(true);
    expect(await outcome()).toBe("render");
    m.isUserPlatformAdmin.mockResolvedValue(false);
    m.mode = "demo";
    expect(await outcome()).toBe("render");
  });
});
