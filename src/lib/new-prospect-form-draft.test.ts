import { describe, expect, it } from "vitest";

import {
  emptyNewProspectFormDraft,
  mergePrefillIntoDraft,
} from "./new-prospect-form-draft";

describe("new prospect form defaults", () => {
  it("starts from an empty manual form", () => {
    const form = emptyNewProspectFormDraft();
    expect(form.bizName).toBe("");
    expect(form.channel).toBe("cold_email");
    expect(form.qualifyForm.qualifyStatus).toBe("completed");
  });

  it("applies launcher prefill only to empty fields", () => {
    const draft = emptyNewProspectFormDraft();
    draft.leadNotes = "Already typed";
    const merged = mergePrefillIntoDraft(draft, {
      leadNotes: "Expansion signal",
      painPoints: "No WMS",
      channel: "linkedin_outbound",
      strategyId: "strategy-1",
      personaId: "persona-1",
      strategyAssignmentId: "assignment-1",
      strategyVersion: 3,
    });

    expect(merged.leadNotes).toBe("Already typed");
    expect(merged.painPoints).toBe("No WMS");
    expect(merged.channel).toBe("linkedin_outbound");
    expect(merged.strategyId).toBe("strategy-1");
    expect(merged.personaId).toBe("persona-1");
    expect(merged.strategyAssignmentId).toBe("assignment-1");
    expect(merged.strategyVersion).toBe(3);
  });

  it("leaves an existing non-default channel untouched", () => {
    const draft = emptyNewProspectFormDraft();
    draft.channel = "job_apply";
    expect(
      mergePrefillIntoDraft(draft, { channel: "linkedin_outbound" }).channel,
    ).toBe("job_apply");
  });
});
