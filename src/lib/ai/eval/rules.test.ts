import { describe, expect, it } from "vitest";
import { evaluateSequenceRules, summarizeRuleResults } from "@/lib/ai/eval/rules";

describe("evaluateSequenceRules", () => {
  it("blocks false prior contact claims", () => {
    const results = evaluateSequenceRules({
      contextText: "Acme Corp Jane Doe VP Engineering",
      steps: [
        {
          stepIndex: 0,
          subject: "Quick idea",
          body: "As discussed, wanted to share a thought on Acme Corp hiring.",
        },
      ],
    });
    const hit = results.find((r) => r.id === "false_prior_contact_0");
    expect(hit?.passed).toBe(false);
    expect(summarizeRuleResults(results).passed).toBe(false);
  });

  it("blocks links in step 1", () => {
    const results = evaluateSequenceRules({
      contextText: "Acme",
      steps: [
        {
          stepIndex: 0,
          subject: "Idea",
          body: "See https://example.com for more.",
        },
      ],
    });
    expect(results.find((r) => r.id === "no_link_step1")?.passed).toBe(false);
  });

  it("passes a clean short email", () => {
    const results = evaluateSequenceRules({
      contextText: "Acme Corp Jane Doe engineering hiring velocity",
      wordTargetMin: 20,
      wordTargetMax: 120,
      steps: [
        {
          stepIndex: 0,
          subject: "Hiring velocity",
          body: "Jane — noticed Acme Corp is scaling engineering. Curious if hiring velocity is a pain this quarter?",
          dueOffsetDays: 0,
        },
        {
          stepIndex: 1,
          subject: "One more thought",
          body: "Jane — one peer pattern on hiring velocity at similar teams. Worth a 15-min look?",
          dueOffsetDays: 3,
        },
      ],
    });
    expect(summarizeRuleResults(results).blockFailures).toHaveLength(0);
  });
});
