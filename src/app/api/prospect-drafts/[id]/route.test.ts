import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  discardProspectDraft,
  getProspectDraft,
  ProspectDraftRevisionError,
  updateProspectDraftFields,
} from "@/lib/prospects/draft-server";

vi.mock("@/lib/platform/tenant-api-guard", () => ({
  guardTenantApi: vi.fn().mockResolvedValue({
    ok: true,
    ctx: { session: { organizationId: "org-1", uid: "user-1" }, role: "member" },
  }),
}));

vi.mock("@/lib/prospects/draft-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/prospects/draft-server")>();
  return {
    ...actual,
    discardProspectDraft: vi.fn(),
    getProspectDraft: vi.fn(),
    updateProspectDraftFields: vi.fn(),
  };
});

import { DELETE, GET, PATCH } from "./route";

const context = { params: Promise.resolve({ id: "pd-1" }) };

describe("/api/prospect-drafts/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("owner-scopes individual reads", async () => {
    vi.mocked(getProspectDraft).mockResolvedValue(null);

    const response = await GET(new Request("https://nova.test"), context);

    expect(response.status).toBe(404);
    expect(getProspectDraft).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "user-1",
      draftId: "pd-1",
    });
  });

  it("rejects malformed updates and deletes", async () => {
    const update = await PATCH(
      new Request("https://nova.test", { method: "PATCH", body: JSON.stringify({ revision: -1 }) }),
      context,
    );
    const discard = await DELETE(
      new Request("https://nova.test", { method: "DELETE", body: JSON.stringify({ reason: "" }) }),
      context,
    );

    expect(update.status).toBe(400);
    expect(discard.status).toBe(400);
  });

  it("returns a stable revision conflict response", async () => {
    vi.mocked(updateProspectDraftFields).mockRejectedValue(new ProspectDraftRevisionError(7));

    const response = await PATCH(
      new Request("https://nova.test", {
        method: "PATCH",
        body: JSON.stringify({ values: {}, revision: 2 }),
      }),
      context,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "revision_conflict",
      currentRevision: 7,
    });
  });

  it("passes owner and revision when discarding", async () => {
    vi.mocked(discardProspectDraft).mockResolvedValue(true);

    const response = await DELETE(
      new Request("https://nova.test", {
        method: "DELETE",
        body: JSON.stringify({ reason: "Duplicate", revision: 4 }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(discardProspectDraft).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "user-1",
      draftId: "pd-1",
      reason: "Duplicate",
      expectedRevision: 4,
    });
  });
});
