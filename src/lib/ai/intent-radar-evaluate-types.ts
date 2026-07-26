import { z } from "zod";

/** Score weights for combined Intent Radar fit (theme / intent / ICP). */
export const INTENT_RADAR_SCORE_WEIGHTS = {
  themeFit: 0.2,
  buyingIntent: 0.45,
  icpDeliverability: 0.35,
} as const;

/** Cap buying intent for retrospective case studies / awards. */
export const COMPLETED_CASE_STUDY_BUYING_INTENT_CAP = 35;

export const intentRadarPageTypeSchema = z.enum([
  "case_study",
  "job_post",
  "rfp",
  "news",
  "vendor_page",
  "other",
]);

export const intentRadarProjectStageSchema = z.enum([
  "planned",
  "in_progress",
  "completed",
  "unknown",
]);

export const intentRadarPageTypeLabels: Record<
  z.infer<typeof intentRadarPageTypeSchema>,
  string
> = {
  case_study: "Case study / award",
  job_post: "Job posting",
  rfp: "RFP / partner search",
  news: "News / announcement",
  vendor_page: "Vendor / product page",
  other: "Other",
};

export const intentRadarProjectStageLabels: Record<
  z.infer<typeof intentRadarProjectStageSchema>,
  string
> = {
  planned: "Planned",
  in_progress: "In progress",
  completed: "Completed",
  unknown: "Unknown",
};

/**
 * Structured AI evaluation for Intent Radar after lexical scan.
 * OpenAI structured output requires every object property in `required`
 * (Zod `.optional()` / `.default()` are rejected with invalid_json_schema).
 */
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
  /** Server recomputes `combined` and overwrites fitScore/verdict from these three. */
  scores: z.object({
    themeFit: z.number().min(0).max(100),
    buyingIntent: z.number().min(0).max(100),
    icpDeliverability: z.number().min(0).max(100),
  }),
  pageType: intentRadarPageTypeSchema,
  projectStage: intentRadarProjectStageSchema,
  nextSteps: z.array(z.string().min(1).max(280)).max(4),
  watchOuts: z.array(z.string().min(1).max(280)).max(3),
  verdict: z.enum(["pursue", "maybe", "pass"]),
  /** Alias of scores.combined after normalization; keep for existing UI. */
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

export type IntentRadarEvaluateResult = z.infer<typeof intentRadarEvaluateResultSchema> & {
  scores: {
    themeFit: number;
    buyingIntent: number;
    icpDeliverability: number;
    combined: number;
  };
};

export type IntentRadarPageType = z.infer<typeof intentRadarPageTypeSchema>;
export type IntentRadarProjectStage = z.infer<typeof intentRadarProjectStageSchema>;

export type IntentRadarEvaluatePayload = {
  evaluatedAt: string;
  lexicalScore: number;
  adjustedIntentScore: number;
  confirmedCount: number;
  rejectedCount: number;
  uncertainCount: number;
  result: IntentRadarEvaluateResult;
};

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function computeCombinedFitScore(scores: {
  themeFit: number;
  buyingIntent: number;
  icpDeliverability: number;
}): number {
  const combined =
    scores.themeFit * INTENT_RADAR_SCORE_WEIGHTS.themeFit +
    scores.buyingIntent * INTENT_RADAR_SCORE_WEIGHTS.buyingIntent +
    scores.icpDeliverability * INTENT_RADAR_SCORE_WEIGHTS.icpDeliverability;
  return clampScore(combined);
}

export function verdictFromCombinedScore(combined: number): "pursue" | "maybe" | "pass" {
  if (combined >= 72) return "pursue";
  if (combined >= 45) return "maybe";
  return "pass";
}

export function defaultFitLabel(verdict: "pursue" | "maybe" | "pass"): string {
  if (verdict === "pursue") return "Strong fit";
  if (verdict === "maybe") return "Partial fit";
  return "Poor fit";
}

/**
 * Apply buying-intent cap, recompute combined, and align verdict/fitScore.
 * Call after model (or demo) output so weights stay consistent.
 */
export function normalizeIntentRadarEvaluateResult(
  result: z.infer<typeof intentRadarEvaluateResultSchema>,
): IntentRadarEvaluateResult {
  let themeFit = clampScore(result.scores.themeFit);
  let buyingIntent = clampScore(result.scores.buyingIntent);
  let icpDeliverability = clampScore(result.scores.icpDeliverability);

  const pageType = result.pageType;
  const projectStage = result.projectStage;

  if (pageType === "case_study" && projectStage === "completed") {
    buyingIntent = Math.min(buyingIntent, COMPLETED_CASE_STUDY_BUYING_INTENT_CAP);
  }

  const scores = {
    themeFit,
    buyingIntent,
    icpDeliverability,
    combined: computeCombinedFitScore({
      themeFit,
      buyingIntent,
      icpDeliverability,
    }),
  };

  const verdict = verdictFromCombinedScore(scores.combined);
  const nextSteps = result.nextSteps
    .map((step) => step.trim())
    .filter(Boolean)
    .slice(0, 4);
  const watchOuts = result.watchOuts
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);

  return {
    ...result,
    pageType,
    projectStage,
    scores,
    nextSteps:
      nextSteps.length > 0
        ? nextSteps
        : ["Review page context manually before outreach."],
    watchOuts,
    verdict,
    fitScore: scores.combined,
    fitLabel: result.fitLabel.trim() || defaultFitLabel(verdict),
    pursueRecommendation: {
      ...result.pursueRecommendation,
      shouldPursue: verdict !== "pass",
    },
  };
}

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
