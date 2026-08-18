import { describe, expect, it } from "vitest";

import {
  CRM_ARCHIVE_COLLECTIONS,
  serializeFirestoreValue,
} from "@/lib/db/export-firestore-crm-archive";

describe("serializeFirestoreValue", () => {
  it("passes through primitives", () => {
    expect(serializeFirestoreValue("a")).toBe("a");
    expect(serializeFirestoreValue(1)).toBe(1);
    expect(serializeFirestoreValue(true)).toBe(true);
    expect(serializeFirestoreValue(null)).toBeNull();
  });

  it("converts Date to ISO", () => {
    expect(serializeFirestoreValue(new Date("2026-08-12T00:00:00.000Z"))).toBe(
      "2026-08-12T00:00:00.000Z",
    );
  });

  it("converts Timestamp-like toDate()", () => {
    const ts = {
      toDate: () => new Date("2026-08-11T12:00:00.000Z"),
    };
    expect(serializeFirestoreValue(ts)).toBe("2026-08-11T12:00:00.000Z");
  });

  it("converts _seconds payload", () => {
    const seconds = Math.floor(Date.parse("2026-08-12T00:00:00.000Z") / 1000);
    expect(serializeFirestoreValue({ _seconds: seconds, _nanoseconds: 0 })).toBe(
      "2026-08-12T00:00:00.000Z",
    );
  });

  it("walks nested objects and arrays", () => {
    const out = serializeFirestoreValue({
      name: "Acme",
      nested: { at: new Date("2026-01-01T00:00:00.000Z") },
      tags: ["a", new Date("2026-02-01T00:00:00.000Z")],
    }) as Record<string, unknown>;
    expect(out.name).toBe("Acme");
    expect((out.nested as { at: string }).at).toBe("2026-01-01T00:00:00.000Z");
    expect(out.tags).toEqual(["a", "2026-02-01T00:00:00.000Z"]);
  });
});

describe("CRM_ARCHIVE_COLLECTIONS", () => {
  it("covers core dual-written entities + dashboard summary", () => {
    expect(CRM_ARCHIVE_COLLECTIONS).toEqual([
      "organizations",
      "accounts",
      "contacts",
      "leads",
      "deals",
      "orgDashboardSummaries",
    ]);
  });
});
