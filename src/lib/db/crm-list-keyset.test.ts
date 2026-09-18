import { describe, expect, it } from "vitest";

import {
  keysetDuplicateIdsAcrossPages,
  keysetRowBeforeCursor,
  mergeCrmListPagesById,
} from "@/lib/db/crm-list-keyset";

describe("mergeCrmListPagesById", () => {
  it("dedupes the same id across pages (concurrent updatedAt bump)", () => {
    const page1 = [
      { id: "a", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "b", updatedAt: "2026-01-01T00:00:00.000Z" },
    ];
    const page2 = [
      { id: "a", updatedAt: "2026-01-02T00:00:00.000Z" },
      { id: "c", updatedAt: "2026-01-01T00:00:00.000Z" },
    ];
    const merged = mergeCrmListPagesById([page1, page2]);
    expect(merged.map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
    expect(merged.find((r) => r.id === "a")?.updatedAt).toBe("2026-01-02T00:00:00.000Z");
  });
});

describe("keysetDuplicateIdsAcrossPages", () => {
  it("finds overlap ids between consecutive pages", () => {
    const dupes = keysetDuplicateIdsAcrossPages(
      [{ id: "x", updatedAt: "2026-01-01T00:00:00.000Z" }],
      [{ id: "x", updatedAt: "2026-01-02T00:00:00.000Z" }],
    );
    expect(dupes).toEqual(["x"]);
  });
});

describe("keysetRowBeforeCursor", () => {
  it("orders by updatedAt desc then id desc", () => {
    const cursor = { updatedAt: new Date("2026-01-02T00:00:00.000Z"), id: "m" };
    expect(
      keysetRowBeforeCursor(
        { id: "z", updatedAt: "2026-01-01T00:00:00.000Z" },
        cursor,
      ),
    ).toBe(true);
    expect(
      keysetRowBeforeCursor(
        { id: "a", updatedAt: "2026-01-02T00:00:00.000Z" },
        cursor,
      ),
    ).toBe(true);
    expect(
      keysetRowBeforeCursor(
        { id: "z", updatedAt: "2026-01-02T00:00:00.000Z" },
        cursor,
      ),
    ).toBe(false);
  });
});
