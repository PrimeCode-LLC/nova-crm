import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/documents/resolve-owner-manager-ids-client", () => ({
  resolveOwnerManagerIdsClient: vi.fn(async () => ["mgr-1"]),
}));

import { persistDealCreateClient } from "@/lib/documents/persist-deal-create-client";
import type { Deal } from "@/lib/types";

describe("persistDealCreateClient (QA 2.10)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates the deal on the server through crm-write", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {});
    const deal = {
      id: "d-1", leadId: "l-1", accountId: "a-1", contactId: "c-1", name: "Big deal", stage: "qualified",
      value: 100, currency: "USD", probability: 20, ownerId: "u-1", expectedCloseDate: undefined,
      createdAt: "2026-10-21T00:00:00.000Z", updatedAt: "2026-10-21T00:00:00.000Z",
    } as unknown as Deal;

    await persistDealCreateClient(null, "org-1", deal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/org/crm-write");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ action: "upsert", entity: "deal", id: "d-1" });
    expect(body.doc).toMatchObject({ name: "Big deal", organizationId: "org-1", ownerManagerIds: ["mgr-1"] });
    expect(body.doc).not.toHaveProperty("id");
    expect(body.doc).not.toHaveProperty("expectedCloseDate");
  });

  it("throws when the server refuses, so the dialog stays open", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "nope" }), { status: 403 })));
    vi.stubGlobal("window", {});
    await expect(
      persistDealCreateClient(null, "org-1", { id: "d-2", ownerId: "u-1" } as unknown as Deal),
    ).rejects.toThrow();
  });
});
