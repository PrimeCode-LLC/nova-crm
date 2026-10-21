import { afterEach, describe, expect, it, vi } from "vitest";

import { CRM_WRITE_EVENT, persistCrmWriteClient } from "@/lib/db/crm-write-client";

describe("crm-write client notifies list caches (QA 3.1)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fires an event naming the written entities after success only", async () => {
    const events: unknown[] = [];
    const target = new EventTarget();
    target.addEventListener(CRM_WRITE_EVENT, (e) => events.push((e as CustomEvent).detail));
    vi.stubGlobal("window", target);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "no" }), { status: 403 })),
    );
    const doc = { id: "x", doc: {} };
    await persistCrmWriteClient({ action: "upsert_graph", account: doc, contact: doc, lead: doc });
    await expect(persistCrmWriteClient({ action: "patch", entity: "deal", id: "d", patch: {} })).rejects.toThrow();
    expect(events).toEqual([{ entities: ["account", "contact", "lead"], created: true }]);
  });
});
