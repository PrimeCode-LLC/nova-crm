import { describe, expect, it } from "vitest";
import { reviewedKeysAfterDraftSave } from "./draft-autosave";

describe("draft autosave acknowledgement", () => {
  it("retains dirty keys when edits arrive while a save is in flight", () => {
    const current = new Set(["companyName", "contactEmail"] as const);

    expect([...reviewedKeysAfterDraftSave(current, 2, 3)]).toEqual([
      "companyName",
      "contactEmail",
    ]);
    expect(reviewedKeysAfterDraftSave(current, 3, 3).size).toBe(0);
  });
});
