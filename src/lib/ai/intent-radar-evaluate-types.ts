import { z } from "zod";

/** Structured AI evaluation for Intent Radar after lexical scan. */
export const intentRadarEvaluateResultSchema = z.object({
  signalReviews: z.array(
    z.object({
      signalId: z.string(),
      label: z.string(),
      decision: z.enum(["confirm", "reject", "uncertain"]),
      polarity: z.enum(["positive_intent", "negative_or_noise", "neutral"]),
      reason: z.string(),
    }),
  ),
  verdict: z.enum(["pursue", "maybe", "pass"]),
  fitScore: z.number().min(0).max(100),
  fitLabel: z.string(),
  summary: z.string(),
  strongMatches: z.array(
    z.object({
      point: z.string(),
      sourceTitle: z.string(),
    }),
  ),
  gaps: z.array(
    z.object({
      point: z.string(),
      severity: z.enum(["blocker", "minor"]),
      gapKind: z.enum(["opportunity", "company_capability", "commercial", "info_missing"]),
    }),
  ),
  pursueRecommendation: z.object({
    shouldPursue: z.boolean(),
    headline: z.string(),
    reasoning: z.string(),
    estimatedEffort: z.enum(["low", "medium", "high"]),
  }),
  ragCitations: z.array(
    z.object({
      title: z.string(),
      excerpt: z.string(),
    }),
  ),
});

export type IntentRadarEvaluateResult = z.infer<typeof intentRadarEvaluateResultSchema>;

export type IntentRadarEvaluatePayload = {
  evaluatedAt: string;
  lexicalScore: number;
  adjustedIntentScore: number;
  confirmedCount: number;
  rejectedCount: number;
  uncertainCount: number;
  result: IntentRadarEvaluateResult;
};

export function computeAdjustedIntentScore(
  signals: { signalId: string; points: number }[],
  reviews: IntentRadarEvaluateResult["signalReviews"],
): {
  adjustedIntentScore: number;
  confirmedCount: number;
  rejectedCount: number;
  uncertainCount: number;
} {
  const byId = new Map(reviews.map((review) => [review.signalId, review]));
  let adjusted = 0;
  let confirmedCount = 0;
  let rejectedCount = 0;
  let uncertainCount = 0;
  for (const signal of signals) {
    const review = byId.get(signal.signalId);
    if (!review) continue;
    if (review.decision === "confirm") {
      confirmedCount += 1;
      adjusted += Math.max(0, signal.points);
    } else if (review.decision === "reject") {
      rejectedCount += 1;
    } else {
      uncertainCount += 1;
    }
  }
  return {
    adjustedIntentScore: Math.min(100, Math.round(adjusted)),
    confirmedCount,
    rejectedCount,
    uncertainCount,
  };
}
