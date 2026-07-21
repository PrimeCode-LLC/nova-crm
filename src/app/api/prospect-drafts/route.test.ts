import { beforeEach, describe, expect, it, vi } from "vitest";
import { createManualProspectDraft, listProspectDraftPage } from "@/lib/prospects/draft-server";

vi.mock("@/lib/platform/tenant-api-guard", () => ({
  guardTenantApi: vi.fn().mockResolvedValue({
    ok: true,
    ctx: {
      session: { organizationId: "org-1", uid: "user-1" },
      role: "member",
    },
  }),
}));

vi.mock("@/lib/prospects/draft-server", () => ({
  createManualProspectDraft: vi.fn(),
  listProspectDraftPage: vi.fn(),
}));

import { GET, POST } from "./route";

describe("/api/prospect-drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listProspectDraftPage).mockResolvedValue({
      drafts: [],
      nextCursor: undefined,
    });
  });

  it("always scopes listings to the signed-in owner", async () => {
    await GET(
      new Request("https://nova.test/api/prospect-drafts?owner=all&status=active"),
    );

    expect(listProspectDraftPage).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        userId: "user-1",
        status: "active",
      }),
    );
  });

  it("rejects malformed create requests", async () => {
    const response = await POST(
      new Request("https://nova.test/api/prospect-drafts", {
        method: "POST",
        body: JSON.stringify({ destination: "x".repeat(501) }),
      }),
    );

    expect(response.status).toBe(400);
    expect(createManualProspectDraft).not.toHaveBeenCalled();
  });

  it("creates a manual owner-scoped draft", async () => {
    vi.mocked(createManualProspectDraft).mockResolvedValue({ id: "pd-1" } as never);

    const response = await POST(
      new Request("https://nova.test/api/prospect-drafts", {
        method: "POST",
        body: JSON.stringify({ sourceContext: "prospects_page" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(createManualProspectDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        userId: "user-1",
        sourceContext: "prospects_page",
      }),
    );
  });
});
