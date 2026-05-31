import type { OpportunityFitResult, OpportunitySourceType } from "@/lib/ai/opportunity-fit-types";

export function demoOpportunityFitResult(
  sourceType: OpportunitySourceType,
  title?: string,
): OpportunityFitResult {
  const label = title?.trim() || "Sample opportunity";
  return {
    verdict: sourceType === "upwork" ? "maybe" : "pursue",
    fitScore: sourceType === "upwork" ? 58 : 78,
    fitLabel: sourceType === "upwork" ? "Partial fit" : "Strong alignment",
    summary: `Demo analysis for “${label}”. In workspace mode with AI keys configured, this is replaced by a live fit check against your knowledge libraries.`,
    dimensions: [
      { key: "services", label: "Services match", score: 82, note: "Core stack aligns with positioning doc." },
      { key: "budget", label: "Budget / rate", score: sourceType === "upwork" ? 45 : 70, note: "Rate band is tight for Upwork-style posts." },
      { key: "timeline", label: "Timeline", score: 75, note: "Reasonable start window." },
      { key: "geo", label: "Geography", score: 90, note: "Remote-friendly." },
      { key: "buyer", label: "Buyer type", score: 65, note: "Mid-market; verify decision-maker access." },
      { key: "stack", label: "Tech stack", score: 80, note: "Matches preferred technologies." },
    ],
    strongMatches: [
      { point: "Needs React + Node delivery — in your sweet spot", sourceTitle: "Services overview" },
      { point: "Ongoing retainer potential mentioned", sourceTitle: "ICP — ideal customer" },
      { point: "Clear problem statement (legacy migration)", sourceTitle: "" },
    ],
    gaps: [
      { point: "Budget not stated explicitly — confirm before investing time", severity: "minor" },
      ...(sourceType === "upwork"
        ? [{ point: "High competition / race-to-bottom risk on platform", severity: "minor" as const }]
        : []),
      { point: "Security/compliance requirements unclear", severity: "minor" },
    ],
    hooks: [
      {
        angle: "De-risk the migration",
        painPoint: "Fear of downtime during legacy cutover",
        opener: `Hi — saw you're planning a migration. We've helped similar teams ship in phases so production stays stable. Happy to share a 2-slide approach if useful.`,
      },
      {
        angle: "Speed to first milestone",
        painPoint: "Pressure to show progress to stakeholders",
        opener: `Quick note: we typically land a visible win in the first 2–3 weeks (audit + thin slice). If timeline is the bottleneck, I can outline what that looks like for your stack.`,
      },
    ],
    pursueRecommendation: {
      shouldPursue: sourceType !== "upwork",
      headline: sourceType === "upwork" ? "Worth a short proposal if you need volume" : "Worth pursuing — personalize and send",
      reasoning:
        sourceType === "upwork"
          ? "Partial fit: good skills match but verify rate and competition. Spend ≤20 min on a tailored opener unless pipeline is empty."
          : "Strong service and stack alignment. Invest 30–45 min in a tailored outreach using hook 1.",
      estimatedEffort: sourceType === "upwork" ? "medium" : "low",
    },
    ragCitations: [
      {
        title: "Services overview (demo)",
        excerpt: "We build and maintain React/Node products for B2B teams…",
      },
    ],
  };
}
