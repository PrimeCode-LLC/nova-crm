import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getVerifiedSession: vi.fn(),
  recordErrorLog: vi.fn(async () => "id"),
  verifyToken: vi.fn(),
  getUser: vi.fn(),
  resolveClerkIdentity: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ getVerifiedSession: m.getVerifiedSession }));
vi.mock("@/lib/error-logging/record-error-server", () => ({ recordErrorLog: m.recordErrorLog }));
vi.mock("@clerk/nextjs/server", () => ({
  verifyToken: m.verifyToken,
  createClerkClient: () => ({ users: { getUser: m.getUser } }),
}));
vi.mock("@/lib/auth/clerk-identity", () => ({ resolveClerkIdentity: m.resolveClerkIdentity }));

import { reportRequestErrorServer } from "@/lib/error-logging/on-request-error-server";

describe("onRequestError → workspace error log (QA 2.8 / ROB-08)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLERK_SECRET_KEY = "sk_test_local";
  });

  it("records an unhandled error in the session's workspace", async () => {
    m.getVerifiedSession.mockResolvedValue({ uid: "u1", email: "u1@nova.test", organizationId: "org-1" });
    await reportRequestErrorServer(new Error("boom"), { path: "/api/x", method: "POST" }, { routePath: "/api/x/route", routeType: "route" });
    expect(m.recordErrorLog).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", message: "boom", httpStatus: 500, route: "/api/x/route", source: "server" }),
    );
  });

  it("falls back to the verified Clerk token when the request context is gone", async () => {
    m.getVerifiedSession.mockRejectedValue(new Error("no context"));
    m.verifyToken.mockResolvedValue({ sub: "user_clerk" });
    m.getUser.mockResolvedValue({ id: "user_clerk" });
    m.resolveClerkIdentity.mockResolvedValue({ uid: "u2", email: "u2@nova.test", organizationId: "org-2" });
    await reportRequestErrorServer(
      new Error("boom"),
      { path: "/api/y", method: "GET", headers: { "x-clerk-auth-token": "jwt" } },
      {},
    );
    expect(m.verifyToken).toHaveBeenCalledWith("jwt", { secretKey: "sk_test_local" });
    expect(m.recordErrorLog).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-2", actorUid: "u2" }));
  });

  it("ignores an unverifiable token and never throws", async () => {
    m.getVerifiedSession.mockResolvedValue(null);
    m.verifyToken.mockRejectedValue(new Error("bad signature"));
    await expect(
      reportRequestErrorServer(new Error("boom"), { path: "/p", method: "GET", headers: { "x-clerk-auth-token": "forged" } }, {}),
    ).resolves.toBeUndefined();
    expect(m.recordErrorLog).not.toHaveBeenCalled();
  });
});
