import { describe, expect, it } from "vitest";

import {
  draftStorageKey,
  emptyNewProspectFormDraft,
  legacyDraftStorageKey,
  parseLocalProspectDraftRecovery,
} from "./new-prospect-form-draft";

describe("new prospect local draft recovery", () => {
  it("scopes current recovery data to the server draft id", () => {
    expect(legacyDraftStorageKey(" user-1 ")).toBe(
      "crm:new-prospect-draft:v2:user-1",
    );
    expect(draftStorageKey("user-1", "pd-1")).toBe(
      "crm:new-prospect-draft:v2:user-1:draft:pd-1",
    );
    expect(draftStorageKey("user-1", "pd-2")).not.toBe(
      draftStorageKey("user-1", "pd-1"),
    );
  });

  it("reads both recovery envelopes and the legacy raw form", () => {
    const form = emptyNewProspectFormDraft();
    form.bizName = "Nova";
    expect(
      parseLocalProspectDraftRecovery(
        JSON.stringify({
          form,
          revision: 4,
          savedAt: "2026-07-21T01:00:00.000Z",
        }),
      ),
    ).toMatchObject({ form: { bizName: "Nova" }, revision: 4 });
    expect(
      parseLocalProspectDraftRecovery(JSON.stringify(form))?.form.bizName,
    ).toBe("Nova");
    expect(
      parseLocalProspectDraftRecovery(
        JSON.stringify({ ...form, v: 1, bizName: "Legacy Nova" }),
      )?.form,
    ).toMatchObject({ v: 2, bizName: "Legacy Nova" });
  });

  it("rejects malformed or obsolete form data", () => {
    expect(parseLocalProspectDraftRecovery("{")).toBeNull();
    expect(parseLocalProspectDraftRecovery(JSON.stringify({ v: 99 }))).toBeNull();
  });
});
