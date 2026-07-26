import type { IntentRadarEvaluateResult } from "@/lib/ai/intent-radar-evaluate-types";

export function demoIntentRadarEvaluateResult(input: {
  title: string;
  signals: { signalId: string; label: string; points: number; reason: string }[];
}): IntentRadarEvaluateResult {
  const signalReviews = input.signals.map((signal, index) => {
    const rejectFundingNoise =
      /fund|invest|acquisition|series/i.test(signal.label) &&
      /lost|decline|cut|fail/i.test(`${signal.reason} ${input.title}`);
    if (rejectFundingNoise || index === input.signals.length - 1) {
      return {
        signalId: signal.signalId,
        label: signal.label,
        decision: "reject" as const,
        polarity: "negative_or_noise" as const,
        reason:
          "Demo: keyword hit lacks positive buying context (e.g. lost funding vs raised capital).",
      };
    }
    return {
      signalId: signal.signalId,
      label: signal.label,
      decision: "confirm" as const,
      polarity: "positive_intent" as const,
      reason: "Demo: context supports a real demand signal on this page.",
    };
  });

  const confirmed = signalReviews.filter((item) => item.decision === "confirm").length;
  const fitScore = confirmed === 0 ? 28 : confirmed === 1 ? 52 : 74;
  const verdict = fitScore >= 72 ? "pursue" : fitScore >= 45 ? "maybe" : "pass";

  return {
    signalReviews,
    verdict,
    fitScore,
    fitLabel:
      verdict === "pursue"
        ? "Strong alignment"
        : verdict === "maybe"
          ? "Partial fit"
          : "Poor fit",
    summary: `Demo AI evaluation for “${input.title}”. Confirmed ${confirmed} of ${input.signals.length} lexical signals after context review. Live mode uses your Fit Check knowledge base.`,
    strongMatches:
      confirmed > 0
        ? [
            {
              point: "At least one intent signal holds up in context",
              sourceTitle: "Demo ICP",
            },
          ]
        : [],
    gaps: [
      {
        point: "Lexical matches can over-count without context; confirm buyer and budget before outreach",
        severity: "minor",
        gapKind: "info_missing",
      },
    ],
    pursueRecommendation: {
      shouldPursue: verdict !== "pass",
      headline:
        verdict === "pursue"
          ? "Worth a qualified outreach"
          : verdict === "maybe"
            ? "Needs more research"
            : "Skip for now",
      reasoning:
        "Demo mode only. Configure AI keys and Fit Check libraries for live knowledge-grounded scoring.",
      estimatedEffort: "medium",
    },
    ragCitations: [],
  };
}
