import { describe, expect, it } from "vitest";
import {
  FIELD_DELETE,
  applyFieldValues,
  resolveWriteData,
} from "@/lib/db/document-shim/field-values";
import { FieldValue } from "@/lib/db/document-shim/shim-firestore";

describe("applyFieldValues dotted paths", () => {
  it("increments nested counters used by import job patches", () => {
    const next = applyFieldValues(
      { counts: { created: 2, updated: 1 } },
      {
        "counts.created": FieldValue.increment(3),
        "counts.failed": FieldValue.increment(1),
      },
    );
    expect(next.counts).toEqual({ created: 5, updated: 1, failed: 1 });
  });

  it("deletes a nested leaf via dotted FieldValue.delete", () => {
    const next = applyFieldValues(
      { stats: { sent: 4, opened: 1 } },
      { "stats.opened": FIELD_DELETE },
    );
    expect(next.stats).toEqual({ sent: 4 });
  });

  it("expands dotted keys on set via resolveWriteData", () => {
    const next = resolveWriteData({
      "counts.created": 1,
      name: "job",
    });
    expect(next).toEqual({ counts: { created: 1 }, name: "job" });
  });
});
