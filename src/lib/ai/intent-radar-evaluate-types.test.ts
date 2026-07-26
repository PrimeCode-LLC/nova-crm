import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { z } from "zod";
import {
  COMPLETED_CASE_STUDY_BUYING_INTENT_CAP,
  computeAdjustedIntentScore,
  computeCombinedFitScore,
  intentRadarEvaluateResultSchema,
  normalizeIntentRadarEvaluateResult,
  verdictFromCombinedScore,
} from "@/lib/ai/intent-radar-evaluate-types";

type IntentRadarEvaluateRaw = z.infer<typeof intentRadarEvaluateResultSchema>;

function baseResult(
  overrides: Partial<IntentRadarEvaluateRaw> = {},
): IntentRadarEvaluateRaw {
  return {
    signalReviews: [],
    scores: {
      themeFit: 85,
      buyingIntent: 80,
      icpDeliverability: 60,
    },
    pageType: "other",
    projectStage: "unknown",
    nextSteps: ["Confirm timing."],
    watchOuts: [],
    verdict: "pursue",
    fitScore: 80,
    fitLabel: "Strong fit",
    summary: "Test summary",
    strongMatches: [],
    gaps: [],
    pursueRecommendation: {
      shouldPursue: true,
      headline: "Pursue",
      reasoning: "Test",
      estimatedEffort: "medium",
    },
    ragCitations: [],
    ...overrides,
  };
}

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

describe("computeCombinedFitScore", () => {
  it("weights buying intent highest", () => {
    // 0.2*85 + 0.45*25 + 0.35*60 = 17 + 11.25 + 21 = 49.25 → 49
    assert.equal(
      computeCombinedFitScore({
        themeFit: 85,
        buyingIntent: 25,
        icpDeliverability: 60,
      }),
      49,
    );
  });
});

describe("normalizeIntentRadarEvaluateResult", () => {
  it("caps buying intent for completed case studies and realigns verdict", () => {
    const normalized = normalizeIntentRadarEvaluateResult(
      baseResult({
        pageType: "case_study",
        projectStage: "completed",
        scores: {
          themeFit: 85,
          buyingIntent: 90,
          icpDeliverability: 60,
        },
        fitLabel: "Theme match, weak buying intent",
        pursueRecommendation: {
          shouldPursue: true,
          headline: "Use for lookalike prospecting",
          reasoning: "Completed award post",
          estimatedEffort: "low",
        },
      }),
    );

    assert.equal(normalized.scores.buyingIntent, COMPLETED_CASE_STUDY_BUYING_INTENT_CAP);
    assert.equal(
      normalized.scores.combined,
      computeCombinedFitScore({
        themeFit: 85,
        buyingIntent: COMPLETED_CASE_STUDY_BUYING_INTENT_CAP,
        icpDeliverability: 60,
      }),
    );
    assert.equal(normalized.fitScore, normalized.scores.combined);
    assert.equal(normalized.verdict, verdictFromCombinedScore(normalized.scores.combined));
    assert.equal(normalized.pursueRecommendation.shouldPursue, normalized.verdict !== "pass");
  });

  it("does not cap buying intent for open RFPs", () => {
    const normalized = normalizeIntentRadarEvaluateResult(
      baseResult({
        pageType: "rfp",
        projectStage: "planned",
        scores: {
          themeFit: 70,
          buyingIntent: 88,
          icpDeliverability: 75,
        },
      }),
    );
    assert.equal(normalized.scores.buyingIntent, 88);
    assert.equal(normalized.verdict, "pursue");
    assert.equal(normalized.fitScore, normalized.scores.combined);
  });

  it("fills scores from fitScore when legacy payload omits them", () => {
    const normalized = normalizeIntentRadarEvaluateResult(
      baseResult({
        scores: undefined,
        fitScore: 64,
        nextSteps: undefined as unknown as string[],
        watchOuts: undefined as unknown as string[],
      }),
    );
    assert.equal(normalized.scores.themeFit, 64);
    assert.equal(normalized.scores.buyingIntent, 64);
    assert.equal(normalized.scores.icpDeliverability, 64);
    assert.equal(normalized.fitScore, normalized.scores.combined);
    assert.ok(normalized.nextSteps.length >= 1);
  });
});
