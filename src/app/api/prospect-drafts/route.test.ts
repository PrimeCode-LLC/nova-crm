import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/tenant-api-guard", () => ({
  guardTenantApi: vi.fn(async () => ({ ok: true, ctx: { session: { uid: "u1", organizationId: "o1" }, role: "owner" } })),
}));
const createManualProspectDraft = vi.hoisted(() => vi.fn(async () => ({ id: "d1" })));
vi.mock("@/lib/prospects/draft-server", async (orig) => ({
  ...(await orig<typeof import("@/lib/prospects/draft-server")>()),
  createManualProspectDraft,
}));

import { POST } from "./route";

const post = (body: string) => POST(new Request("http://localhost/api/prospect-drafts", { method: "POST", body }));

describe("POST /api/prospect-drafts validation (QA 2.8 / ROB-06)", () => {
  it("rejects invalid JSON and content-less bodies instead of creating blank drafts", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post(JSON.stringify({ foo: "bar" }))).status).toBe(400);
    expect((await post(JSON.stringify({}))).status).toBe(400);
    expect(createManualProspectDraft).not.toHaveBeenCalled();
  });

  it("still creates a draft with values", async () => {
    const res = await post(JSON.stringify({ values: { companyName: "Acme" }, origin: "manual" }));
    expect(res.status).toBe(201);
    expect(createManualProspectDraft).toHaveBeenCalledTimes(1);
  });
});
