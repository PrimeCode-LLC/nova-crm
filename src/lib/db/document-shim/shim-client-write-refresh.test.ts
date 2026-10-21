import { afterEach, describe, expect, it, vi } from "vitest";

import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  query,
  setDoc,
  subscribeToLocalDocumentWrites,
  where,
} from "@/lib/db/document-shim/shim-client-firestore";

function okJson(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("client document shim refreshes after local writes (QA 3.1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("re-polls listeners on the written collection right away instead of after 60s", async () => {
    let listCalls = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return okJson({ ok: true });
      listCalls += 1;
      return okJson({ docs: listCalls === 1 ? [] : [{ id: "lbl-1", data: { name: "New" } }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const db = getFirestore();
    const seen: number[] = [];
    const unsub = onSnapshot(query(collection(db, "labels"), where("organizationId", "==", "o1")), (snap) => {
      seen.push(snap.docs.length);
    });
    await vi.waitFor(() => expect(seen).toEqual([0]));

    const writes: string[] = [];
    const unsubWrites = subscribeToLocalDocumentWrites((root) => writes.push(root));
    await setDoc(doc(db, "labels", "lbl-1"), { name: "New" });

    await vi.waitFor(() => expect(seen).toEqual([0, 1]), { timeout: 2000 });
    expect(writes).toEqual(["labels"]);
    unsub();
    unsubWrites();
  });

  it("does not touch listeners on other collections", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? okJson({ ok: true }) : okJson({ docs: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const db = getFirestore();
    let polls = 0;
    const unsub = onSnapshot(collection(db, "profiles"), () => {
      polls += 1;
    });
    await vi.waitFor(() => expect(polls).toBe(1));
    await setDoc(doc(db, "labels", "lbl-2"), { name: "x" });
    await new Promise((r) => setTimeout(r, 50));
    expect(polls).toBe(1);
    unsub();
  });
});
