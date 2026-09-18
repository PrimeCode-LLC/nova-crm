import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetDocumentQuerySingleFlightForTests,
  withDocumentQuerySingleFlight,
  DOCUMENT_QUERY_SINGLEFLIGHT_TTL_MS,
} from "@/lib/db/document-shim/query-singleflight";
import type { QuerySpec, StoredDoc } from "@/lib/db/document-shim/store";

function doc(path: string): StoredDoc {
  return {
    path,
    organizationId: "org-1",
    collectionRoot: "notes",
    payload: { organizationId: "org-1" },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

describe("document query single-flight", () => {
  afterEach(() => {
    resetDocumentQuerySingleFlightForTests();
    vi.useRealTimers();
  });

  it("collapses concurrent identical specs into one loader call", async () => {
    const spec: QuerySpec = {
      collectionRoot: "notes",
      pathPrefix: "notes",
      filters: [{ field: "authorId", op: "==", value: "u1" }],
      limit: 10,
    };
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 30));
      return [doc("notes/n1")];
    };

    const [a, b, c] = await Promise.all([
      withDocumentQuerySingleFlight(spec, loader),
      withDocumentQuerySingleFlight(spec, loader),
      withDocumentQuerySingleFlight(spec, loader),
    ]);

    expect(calls).toBe(1);
    expect(a.map((d) => d.path)).toEqual(["notes/n1"]);
    expect(b.map((d) => d.path)).toEqual(["notes/n1"]);
    expect(c.map((d) => d.path)).toEqual(["notes/n1"]);
    // Callers get clones — mutating one result must not affect another.
    a[0]!.payload.mutated = true;
    expect(b[0]!.payload.mutated).toBeUndefined();
  });

  it("serves short TTL cache then reloads after expiry", async () => {
    vi.useFakeTimers();
    const spec: QuerySpec = {
      collectionRoot: "notes",
      filters: [],
    };
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return [doc(`notes/n${calls}`)];
    };

    const first = await withDocumentQuerySingleFlight(spec, loader);
    const second = await withDocumentQuerySingleFlight(spec, loader);
    expect(calls).toBe(1);
    expect(first[0]!.path).toBe(second[0]!.path);

    vi.advanceTimersByTime(DOCUMENT_QUERY_SINGLEFLIGHT_TTL_MS + 1);
    const third = await withDocumentQuerySingleFlight(spec, loader);
    expect(calls).toBe(2);
    expect(third[0]!.path).toBe("notes/n2");
  });
});
