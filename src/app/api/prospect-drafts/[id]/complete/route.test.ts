import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeProspectDraft, ProspectDraftRevisionError } from "@/lib/prospects/draft-server";

vi.mock("@/lib/platform/tenant-api-guard", () => ({
  guardTenantApi: vi.fn().mockResolvedValue({
    ok: true,
    ctx: { session: { organizationId: "org-1", uid: "user-1" }, role: "member" },
  }),
}));

vi.mock("@/lib/prospects/draft-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/prospects/draft-server")>();
  return { ...actual, completeProspectDraft: vi.fn() };
});

import { POST } from "./route";

const context = { params: Promise.resolve({ id: "pd-1" }) };

describe("/api/prospect-drafts/[id]/complete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects malformed completion requests", async () => {
    const response = await POST(
      new Request("https://nova.test", {
        method: "POST",
        body: JSON.stringify({ revision: -1 }),
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(completeProspectDraft).not.toHaveBeenCalled();
  });

  it("passes owner and expected revision to retry-safe completion", async () => {
    vi.mocked(completeProspectDraft).mockResolvedValue({ leadId: "lead-1" });

    const response = await POST(
      new Request("https://nova.test", {
        method: "POST",
        body: JSON.stringify({ revision: 4, allowIncomplete: true }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, leadId: "lead-1" });
    expect(completeProspectDraft).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "user-1",
      draftId: "pd-1",
      allowIncomplete: true,
      expectedRevision: 4,
    });
  });

  it("returns current revision on conflicts", async () => {
    vi.mocked(completeProspectDraft).mockRejectedValue(new ProspectDraftRevisionError(9));

    const response = await POST(
      new Request("https://nova.test", {
        method: "POST",
        body: JSON.stringify({ revision: 3 }),
      }),
      context,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "revision_conflict",
      currentRevision: 9,
    });
  });
});
