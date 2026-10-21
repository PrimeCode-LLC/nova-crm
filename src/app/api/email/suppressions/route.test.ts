import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/tenant-api-guard", () => ({
  guardTenantApi: vi.fn(async () => ({ ok: true, ctx: { session: { uid: "u1", organizationId: "o1" }, role: "owner" } })),
}));
const addSuppression = vi.hoisted(() => vi.fn(async () => ({ ok: true, id: "s1", created: true })));
vi.mock("@/lib/email/suppression-server", async (orig) => ({
  ...(await orig<typeof import("@/lib/email/suppression-server")>()),
  addSuppression,
}));

import { POST } from "./route";

const post = (body: string) => POST(new Request("http://localhost/api/email/suppressions", { method: "POST", body }));

describe("POST /api/email/suppressions validation (QA 2.8 / ROB-06)", () => {
  it("rejects a non-string email with 400 instead of crashing", async () => {
    expect((await post(JSON.stringify({ email: 123 }))).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify({ email: "a@b.test", reason: "spam" }))).status).toBe(400);
    expect(addSuppression).not.toHaveBeenCalled();
  });

  it("accepts a valid address", async () => {
    expect((await post(JSON.stringify({ email: "a@b.test" }))).status).toBe(200);
    expect(addSuppression).toHaveBeenCalledWith(expect.objectContaining({ email: "a@b.test", reason: "manual" }));
  });
});
