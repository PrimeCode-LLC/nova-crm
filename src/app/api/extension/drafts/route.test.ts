import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSourceToWorkingDraft,
  completeProspectDraft,
  createAndSelectWorkingDraft,
  discardProspectDraft,
  getWorkingDraft,
  listProspectDrafts,
  selectWorkingDraft,
  updateProspectDraftFields,
} from "@/lib/prospects/draft-server";

vi.mock("@/lib/extension/auth-server", () => ({
  extensionOptionsResponse: vi.fn(),
  guardExtensionApi: vi.fn().mockResolvedValue({
    ok: true,
    principal: {
      organizationId: "org-1",
      uid: "user-1",
      email: "user@example.com",
    },
    headers: new Headers({ "Access-Control-Allow-Origin": "chrome-extension://test" }),
  }),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: vi.fn(() => ({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({ set: vi.fn().mockResolvedValue(undefined) })),
    })),
  })),
}));

vi.mock("@/lib/prospects/draft-server", () => ({
  addSourceToWorkingDraft: vi.fn(),
  completeProspectDraft: vi.fn(),
  createAndSelectWorkingDraft: vi.fn(),
  discardProspectDraft: vi.fn(),
  getWorkingDraft: vi.fn(),
  listProspectDrafts: vi.fn(),
  selectWorkingDraft: vi.fn(),
  updateProspectDraftFields: vi.fn(),
}));

vi.mock("@/lib/firestore/audit", () => ({
  recordAudit: vi.fn(),
}));

vi.mock("@/lib/extension/strategy-attribution-server", () => ({
  StrategyAttributionError: class StrategyAttributionError extends Error {},
  validateExtensionStrategyAttribution: vi.fn().mockResolvedValue(undefined),
}));

import { DELETE, GET, PATCH, POST, PUT } from "./route";

const draft = {
  id: "pd-1",
  status: "active",
  fields: {},
  sources: [],
  sourceCount: 0,
  completionPercent: 0,
  missingRequiredFields: ["companyName", "contactName"],
};

describe("/api/extension/drafts compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the legacy GET response unchanged", async () => {
    vi.mocked(getWorkingDraft).mockResolvedValue(draft as never);

    const response = await GET(new Request("https://nova.test/api/extension/drafts"));

    expect(await response.json()).toEqual({ draft });
  });

  it("lists active drafts without changing the legacy GET operation", async () => {
    vi.mocked(listProspectDrafts).mockResolvedValue([draft] as never);
    vi.mocked(getWorkingDraft).mockResolvedValue(draft as never);

    const response = await GET(
      new Request("https://nova.test/api/extension/drafts?operation=list"),
    );

    expect(await response.json()).toEqual({
      drafts: [draft],
      selectedDraftId: "pd-1",
    });
    expect(listProspectDrafts).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "user-1",
      status: "active",
    });
  });

  it("keeps an older selected pointer visible when it falls outside the list cap", async () => {
    const newer = { ...draft, id: "pd-newer" };
    vi.mocked(listProspectDrafts).mockResolvedValue([newer] as never);
    vi.mocked(getWorkingDraft).mockResolvedValue(draft as never);

    const response = await GET(
      new Request("https://nova.test/api/extension/drafts?operation=list"),
    );

    expect(await response.json()).toEqual({
      drafts: [draft, newer],
      selectedDraftId: "pd-1",
    });
  });

  it("supports selecting and creating pointer-backed drafts", async () => {
    vi.mocked(selectWorkingDraft).mockResolvedValue(draft as never);
    vi.mocked(createAndSelectWorkingDraft).mockResolvedValue(draft as never);

    const selectResponse = await POST(
      new Request("https://nova.test/api/extension/drafts", {
        method: "POST",
        body: JSON.stringify({ operation: "select", draftId: "pd-1" }),
      }),
    );
    const createResponse = await POST(
      new Request("https://nova.test/api/extension/drafts", {
        method: "POST",
        body: JSON.stringify({ operation: "new-draft", idempotencyKey: "create-1" }),
      }),
    );

    expect(await selectResponse.json()).toEqual({ draft });
    expect(createResponse.status).toBe(201);
    expect(await createResponse.json()).toEqual({ draft });
    expect(createAndSelectWorkingDraft).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "intent_radar", idempotencyKey: "create-1" }),
    );
  });

  it("targets source saves by draft id when provided", async () => {
    vi.mocked(addSourceToWorkingDraft).mockResolvedValue({
      draft,
      created: false,
      ai: { status: "unavailable", acceptedCount: 0, rejectedCount: 0 },
      warnings: [],
    } as never);

    const response = await POST(
      new Request("https://nova.test/api/extension/drafts", {
        method: "POST",
        body: JSON.stringify({
          draftId: "pd-1",
          revision: 3,
          idempotencyKey: "source-1",
          page: {
            url: "https://example.com/source",
            title: "Source",
            text: "Enough source content for a durable prospect draft.",
            domain: "example.com",
          },
          quality: { score: 42, matchedSignalIds: [] },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(addSourceToWorkingDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: "pd-1",
        expectedRevision: 3,
        idempotencyKey: "source-1",
      }),
    );
  });

  it("accepts the legacy source POST without draft or revision fields", async () => {
    vi.mocked(addSourceToWorkingDraft).mockResolvedValue({
      draft,
      created: false,
      ai: { status: "unavailable", acceptedCount: 0, rejectedCount: 0 },
      warnings: [],
    } as never);

    const response = await POST(
      new Request("https://nova.test/api/extension/drafts", {
        method: "POST",
        body: JSON.stringify({
          page: {
            url: "https://example.com/legacy",
            title: "Legacy source",
            text: "Enough source content for the original extension request contract.",
            domain: "example.com",
          },
          quality: { score: 20, matchedSignalIds: [] },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(addSourceToWorkingDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: undefined,
        expectedRevision: undefined,
        idempotencyKey: undefined,
      }),
    );
  });

  it("falls back to the legacy pointer when edit draftId is omitted", async () => {
    vi.mocked(getWorkingDraft).mockResolvedValue(draft as never);
    vi.mocked(updateProspectDraftFields).mockResolvedValue(draft as never);

    const response = await PATCH(
      new Request("https://nova.test/api/extension/drafts", {
        method: "PATCH",
        body: JSON.stringify({ values: { companyName: "Acme" } }),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateProspectDraftFields).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: "pd-1" }),
    );
  });

  it("forwards revisions from new clients while accepting legacy omission", async () => {
    vi.mocked(updateProspectDraftFields).mockResolvedValue(draft as never);

    await PATCH(
      new Request("https://nova.test/api/extension/drafts", {
        method: "PATCH",
        body: JSON.stringify({ draftId: "pd-1", revision: 4, values: {} }),
      }),
    );
    await PATCH(
      new Request("https://nova.test/api/extension/drafts", {
        method: "PATCH",
        body: JSON.stringify({ draftId: "pd-1", values: {} }),
      }),
    );

    expect(updateProspectDraftFields).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ expectedRevision: 4 }),
    );
    expect(updateProspectDraftFields).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ expectedRevision: undefined }),
    );
  });

  it("falls back to the legacy pointer for completion and discard", async () => {
    vi.mocked(getWorkingDraft).mockResolvedValue(draft as never);
    vi.mocked(completeProspectDraft).mockResolvedValue({ leadId: "lead-1" });
    vi.mocked(discardProspectDraft).mockResolvedValue(true);

    const completeResponse = await PUT(
      new Request("https://nova.test/api/extension/drafts", {
        method: "PUT",
        body: JSON.stringify({}),
      }),
    );
    const discardResponse = await DELETE(
      new Request("https://nova.test/api/extension/drafts", {
        method: "DELETE",
        body: JSON.stringify({ reason: "No longer relevant" }),
      }),
    );

    expect(completeResponse.status).toBe(200);
    expect(discardResponse.status).toBe(200);
    expect(completeProspectDraft).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: "pd-1" }),
    );
    expect(discardProspectDraft).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: "pd-1" }),
    );
  });
});
