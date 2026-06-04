import { z } from "zod";
import type { ChannelKey } from "@/lib/types";

export const OPPORTUNITY_SOURCE_TYPES = [
  "job_apply",
  "upwork",
  "rfp",
  "inbound",
  "cold_outbound",
  "other",
] as const;

export type OpportunitySourceType = (typeof OPPORTUNITY_SOURCE_TYPES)[number];

export const OPPORTUNITY_SOURCE_LABELS: Record<OpportunitySourceType, string> = {
  job_apply: "Job / application",
  upwork: "Upwork / freelance",
  rfp: "RFP / tender",
  inbound: "Inbound email",
  cold_outbound: "Cold outreach reply",
  other: "Other",
};

export const opportunityFitVerdictSchema = z.enum(["pursue", "maybe", "pass"]);

/** OpenAI structured output requires every object property in `required` (no .optional()). */
export const opportunityFitResultSchema = z.object({
  verdict: opportunityFitVerdictSchema,
  fitScore: z.number().min(0).max(100),
  fitLabel: z.string(),
  summary: z.string(),
  dimensions: z.array(
    z.object({
      key: z.enum(["services", "budget", "timeline", "geo", "buyer", "stack"]),
      label: z.string(),
      score: z.number().min(0).max(100),
      note: z.string(),
    }),
  ),
  strongMatches: z.array(
    z.object({
      point: z.string(),
      /** Empty string when not tied to a knowledge doc title. */
      sourceTitle: z.string(),
    }),
  ),
  gaps: z.array(
    z.object({
      point: z.string(),
      severity: z.enum(["blocker", "minor"]),
      /** opportunity = gap in the posting; company_capability = we cannot deliver; commercial = budget/geo; info_missing = unclear JD */
      gapKind: z.enum(["opportunity", "company_capability", "commercial", "info_missing"]),
    }),
  ),
  hooks: z.array(
    z.object({
      angle: z.string(),
      painPoint: z.string(),
      opener: z.string(),
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

export type OpportunityFitResult = z.infer<typeof opportunityFitResultSchema>;

const COMPANY_STACK_DENY_RE =
  /\b(our (core )?stack|we lack|we don'?t (use|offer|support)|company lacks|not in our (stack|toolkit))\b/i;

/** Downgrade LLM mistakes: claiming we lack tech that appears in the RAG corpus. */
export function reconcileFitGapsWithCorpus(
  result: OpportunityFitResult,
  corpusText: string,
): OpportunityFitResult {
  const corpus = corpusText.toLowerCase();
  const techTokens = [
    "next.js",
    "nextjs",
    "typescript",
    "react",
    "node.js",
    "nodejs",
    ".net",
    "aws",
    "postgresql",
    "mongodb",
  ];

  const gaps = result.gaps.map((g) => {
    let gap = { ...g };
    const pointLower = g.point.toLowerCase();

    if (g.gapKind === "company_capability" || COMPANY_STACK_DENY_RE.test(g.point)) {
      for (const tech of techTokens) {
        if (pointLower.includes(tech) && corpus.includes(tech)) {
          gap = {
            ...gap,
            gapKind: "opportunity" as const,
            severity: "minor" as const,
            point: g.point.replace(
              /\b(missing|lacks?|not in (the )?stack)\b/gi,
              "not mentioned in the opportunity",
            ),
          };
          break;
        }
      }
    }

    if (
      gap.severity === "blocker" &&
      (gap.gapKind === "opportunity" || gap.gapKind === "info_missing")
    ) {
      gap = { ...gap, severity: "minor" };
    }

    return gap;
  });

  return { ...result, gaps };
}

/** Trim empty strings from model output for display/storage. */
export function normalizeOpportunityFitResult(
  result: OpportunityFitResult,
  corpusText?: string,
): OpportunityFitResult {
  let normalized: OpportunityFitResult = {
    ...result,
    strongMatches: result.strongMatches.map((m) => ({
      point: m.point,
      sourceTitle: m.sourceTitle.trim(),
    })),
    gaps: result.gaps.map((g) => ({
      ...g,
      gapKind: g.gapKind ?? "opportunity",
    })),
  };

  if (corpusText?.trim()) {
    normalized = reconcileFitGapsWithCorpus(normalized, corpusText);
  }

  return normalized;
}

export type OpportunityFitScan = {
  id: string;
  organizationId: string;
  createdByUserId: string;
  createdByDisplayName?: string;
  title: string;
  sourceType: OpportunitySourceType;
  rawInput: string;
  result: OpportunityFitResult;
  verdict: OpportunityFitResult["verdict"];
  fitScore: number;
  leadId?: string;
  /** Workspace profile whose knowledge libraries were used for this scan. */
  profileId?: string;
  profileDisplayName?: string;
  createdAt: string;
  updatedAt: string;
};

export type OpportunityFitMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

/** Map fit-check source chips to CRM channel keys for prospect creation. */
export function sourceTypeToChannel(source: OpportunitySourceType): ChannelKey {
  switch (source) {
    case "job_apply":
      return "job_apply";
    case "upwork":
      return "upwork";
    case "inbound":
      return "personalized_email";
    case "cold_outbound":
      return "cold_email";
    default:
      return "website_form";
  }
}

export const FIT_GAP_KIND_LABELS: Record<
  NonNullable<OpportunityFitResult["gaps"][number]["gapKind"]>,
  string
> = {
  opportunity: "In the opportunity",
  company_capability: "We cannot deliver",
  commercial: "Commercial / terms",
  info_missing: "Needs clarification",
};

export function verdictMeta(verdict: OpportunityFitResult["verdict"]): {
  label: string;
  className: string;
} {
  switch (verdict) {
    case "pursue":
      return {
        label: "Pursue",
        className:
          "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      };
    case "maybe":
      return {
        label: "Worth a look",
        className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
      };
    case "pass":
      return {
        label: "Pass",
        className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
      };
  }
}
