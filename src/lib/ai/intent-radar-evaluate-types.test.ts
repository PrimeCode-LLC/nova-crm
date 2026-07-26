import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { computeAdjustedIntentScore } from "@/lib/ai/intent-radar-evaluate-types";

describe("computeAdjustedIntentScore", () => {
  it("counts only confirmed signal points", () => {
    const result = computeAdjustedIntentScore(
      [
        { signalId: "funding", points: 20 },
        { signalId: "partner", points: 35 },
        { signalId: "compliance", points: 10 },
      ],
      [
        {
          signalId: "funding",
          label: "Funding",
          decision: "reject",
          polarity: "negative_or_noise",
          reason: "Lost investment",
        },
        {
          signalId: "partner",
          label: "Partner search",
          decision: "confirm",
          polarity: "positive_intent",
          reason: "Looking for a software partner",
        },
        {
          signalId: "compliance",
          label: "Compliance",
          decision: "uncertain",
          polarity: "neutral",
          reason: "Mention only",
        },
      ],
    );
    assert.equal(result.adjustedIntentScore, 35);
    assert.equal(result.confirmedCount, 1);
    assert.equal(result.rejectedCount, 1);
    assert.equal(result.uncertainCount, 1);
  });
});
