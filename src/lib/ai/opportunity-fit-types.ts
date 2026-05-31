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

/** Trim empty strings from model output for display/storage. */
export function normalizeOpportunityFitResult(
  result: OpportunityFitResult,
): OpportunityFitResult {
  return {
    ...result,
    strongMatches: result.strongMatches.map((m) => ({
      point: m.point,
      sourceTitle: m.sourceTitle.trim(),
    })),
  };
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
