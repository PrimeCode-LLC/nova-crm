import {
  normalizeIntentRadarEvaluateResult,
  type IntentRadarEvaluateResult,
} from "@/lib/ai/intent-radar-evaluate-types";

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
  const looksCompletedCaseStudy =
    /award|case study|wins|implementation|rollout completed/i.test(input.title);

  const themeFit = confirmed === 0 ? 35 : confirmed === 1 ? 62 : 84;
  const buyingIntent = looksCompletedCaseStudy
    ? 28
    : confirmed === 0
      ? 20
      : confirmed === 1
        ? 48
        : 72;
  const icpDeliverability = confirmed === 0 ? 40 : confirmed === 1 ? 55 : 68;

  return normalizeIntentRadarEvaluateResult({
    signalReviews,
    scores: {
      themeFit,
      buyingIntent,
      icpDeliverability,
    },
    pageType: looksCompletedCaseStudy ? "case_study" : "other",
    projectStage: looksCompletedCaseStudy ? "completed" : "unknown",
    nextSteps: looksCompletedCaseStudy
      ? [
          "Save as research/intel, not a hot pursue lead.",
          "Capture any named stakeholders for later research.",
          "Hunt lookalike companies still earlier in rollout.",
        ]
      : [
          "Confirm buyer and timing before outreach.",
          "Cross-check ICP fit against knowledge base gaps.",
        ],
    watchOuts: looksCompletedCaseStudy
      ? [
          "Retrospective award/case study — not an open buying signal.",
          "Incumbent vendor may already own the core project.",
        ]
      : ["Lexical matches can over-count without budget or timeline proof."],
    verdict: "maybe",
    fitScore: 0,
    fitLabel: looksCompletedCaseStudy ? "Theme match, weak buying intent" : "Partial fit",
    summary: looksCompletedCaseStudy
      ? `Demo AI evaluation for “${input.title}”. Strong theme language, but the page reads like a completed case study/award — use for lookalike research, not hot outreach.`
      : `Demo AI evaluation for “${input.title}”. Confirmed ${confirmed} of ${input.signals.length} lexical signals after context review. Live mode uses your Fit Check knowledge base.`,
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
        point:
          "Lexical matches can over-count without context; confirm buyer and budget before outreach",
        severity: "minor",
        gapKind: "info_missing",
      },
    ],
    pursueRecommendation: {
      shouldPursue: true,
      headline: looksCompletedCaseStudy
        ? "Use for lookalike prospecting"
        : confirmed > 1
          ? "Worth a qualified outreach"
          : "Needs more research",
      reasoning:
        "Demo mode only. Configure AI keys and org knowledge libraries for live knowledge-grounded scoring.",
      estimatedEffort: "medium",
    },
    ragCitations: [],
  });
}
