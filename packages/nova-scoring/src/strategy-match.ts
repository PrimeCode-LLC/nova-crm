import { corpusConcepts, keywordMatchesCorpus, type MatchEvidence, type TextBlock } from "./text-match";
import type { QualityScoreResult } from "./types";

export type StrategyMatchPersona = {
  id: string;
  name: string;
  active: boolean;
  titles: { title: string; kind: "approved" | "similar" | "excluded" }[];
  industries: string[];
  countries: string[];
  responsibilities: string[];
  businessGoals: string[];
  painPoints: string[];
  buyingTriggers: string[];
  relevantSignalIds: string[];
  priority: number;
};

export type StrategyMatchStrategy = {
  id: string;
  name: string;
  version: number;
  priority: number;
  status: "draft" | "published" | "paused" | "archived";
  personaIds: string[];
  linkedSignals: {
    signalId: string;
    enabled: boolean;
    priority: number;
    required: boolean;
    strength?: "strong" | "medium";
    messageAngle?: string;
  }[];
  firmographics: {
    targetIndustries: string[];
    excludedIndustries: string[];
    targetCountries: string[];
    excludedCountries: string[];
    targetRegions: string[];
    requiredKeywords: string[];
    excludedKeywords: string[];
  };
};

export type StrategyMatchAssignment = {
  id: string;
  strategyId: string;
  assignmentType: "primary" | "secondary";
  priority: number;
  allocationPct: number;
  personaIdsOverride?: string[];
  industryOverride?: string[];
  geographyOverride?: string[];
};

export type StrategyPageInput = {
  text: string;
  title?: string;
  industry?: string;
  country?: string;
  region?: string;
  contactTitle?: string;
  blocks?: readonly TextBlock[];
};

export type AssignedStrategyMatch = {
  strategyId: string;
  strategyName: string;
  strategyVersion: number;
  strategyAssignmentId: string;
  assignmentType: "primary" | "secondary";
  score: number;
  confidence: "low" | "medium" | "high";
  matchedSignalIds: string[];
  missingRequiredSignalIds: string[];
  personaId?: string;
  personaName?: string;
  opportunityLabel?: string;
  disqualified: boolean;
  disqualifiers: string[];
  evidence: MatchEvidence[];
  breakdown: {
    intent: number | null;
    firmographic: number | null;
    persona: number | null;
    assignmentBonus: number;
  };
};

function keywordHit(text: string, keyword: string): boolean {
  const lower = text.toLowerCase();
  return keywordMatchesCorpus(lower, corpusConcepts(lower), keyword);
}

function normalizedText(input: StrategyPageInput): string {
  return [input.title, input.text, input.industry, input.country, input.region, input.contactTitle]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function fitDimension(checks: { known: boolean; pass: boolean }[]): number | null {
  const known = checks.filter((check) => check.known);
  if (!known.length) return null;
  return Math.round((known.filter((check) => check.pass).length / known.length) * 100);
}

function bestPersona(
  personas: readonly StrategyMatchPersona[],
  input: StrategyPageInput,
  matchedSignals: Set<string>,
): { persona?: StrategyMatchPersona; score: number | null; excludedTitle?: string } {
  const text = normalizedText(input);
  let best: { persona?: StrategyMatchPersona; score: number | null; excludedTitle?: string } = {
    score: null,
  };
  for (const persona of personas.filter((item) => item.active)) {
    const excludedTitle = persona.titles
      .filter((item) => item.kind === "excluded")
      .find((item) => keywordHit(input.contactTitle ?? text, item.title))?.title;
    if (excludedTitle) {
      if (!best.excludedTitle) best = { score: 0, excludedTitle };
      continue;
    }
    const checks: { known: boolean; pass: boolean }[] = [];
    const approvedTitles = persona.titles.filter((item) => item.kind !== "excluded");
    if (input.contactTitle && approvedTitles.length) {
      checks.push({
        known: true,
        pass: approvedTitles.some((item) => keywordHit(input.contactTitle!, item.title)),
      });
    }
    const concepts = [
      ...persona.responsibilities,
      ...persona.businessGoals,
      ...persona.painPoints,
      ...persona.buyingTriggers,
    ];
    if (concepts.length) {
      checks.push({ known: true, pass: concepts.some((value) => keywordHit(text, value)) });
    }
    if (persona.relevantSignalIds.length) {
      checks.push({
        known: true,
        pass: persona.relevantSignalIds.some((id) => matchedSignals.has(id)),
      });
    }
    const score = fitDimension(checks);
    const priorityBonus = Math.min(5, Math.max(0, persona.priority));
    const rankedScore = score == null ? null : Math.min(100, score + priorityBonus);
    if (rankedScore != null && (best.score == null || rankedScore > best.score)) {
      best = { persona, score: rankedScore };
    }
  }
  return best;
}

export function rankAssignedStrategies(input: {
  page: StrategyPageInput;
  quality: QualityScoreResult;
  assignments: readonly StrategyMatchAssignment[];
  strategies: readonly StrategyMatchStrategy[];
  personas: readonly StrategyMatchPersona[];
}): AssignedStrategyMatch[] {
  const text = normalizedText(input.page);
  const matchedSignals = new Set(input.quality.matchedSignals.map((signal) => signal.signalId));
  const evidence = input.quality.matchedSignals
    .map((signal) => signal.evidence)
    .filter((item): item is MatchEvidence => Boolean(item));

  return input.assignments
    .map((assignment): AssignedStrategyMatch | null => {
      const strategy = input.strategies.find(
        (item) => item.id === assignment.strategyId && item.status === "published",
      );
      if (!strategy) return null;
      const links = strategy.linkedSignals.filter((link) => link.enabled);
      const possibleIntent = links.reduce(
        (sum, link) =>
          sum +
          Math.max(1, link.priority) *
            (link.strength === "strong" ? 1.5 : link.strength === "medium" ? 1.2 : 1),
        0,
      );
      const matchedIntent = links
        .filter((link) => matchedSignals.has(link.signalId))
        .reduce(
          (sum, link) =>
            sum +
            Math.max(1, link.priority) *
              (link.strength === "strong" ? 1.5 : link.strength === "medium" ? 1.2 : 1),
          0,
        );
      const intentScore =
        possibleIntent > 0 ? Math.round((matchedIntent / possibleIntent) * 100) : null;
      const missingRequiredSignalIds = links
        .filter((link) => link.required && !matchedSignals.has(link.signalId))
        .map((link) => link.signalId);

      const firmographics = strategy.firmographics;
      const targetIndustries =
        assignment.industryOverride?.length
          ? assignment.industryOverride
          : firmographics.targetIndustries;
      const targetCountries =
        assignment.geographyOverride?.length
          ? assignment.geographyOverride
          : firmographics.targetCountries;
      const disqualifiers: string[] = [];
      for (const keyword of firmographics.excludedKeywords) {
        if (keywordHit(text, keyword)) disqualifiers.push(`Excluded keyword: ${keyword}`);
      }
      if (
        input.page.industry &&
        firmographics.excludedIndustries.some((value) =>
          input.page.industry!.toLowerCase().includes(value.toLowerCase()),
        )
      ) {
        disqualifiers.push(`Excluded industry: ${input.page.industry}`);
      }
      if (
        input.page.country &&
        firmographics.excludedCountries.some((value) =>
          input.page.country!.toLowerCase().includes(value.toLowerCase()),
        )
      ) {
        disqualifiers.push(`Excluded country: ${input.page.country}`);
      }
      const firmographicScore = fitDimension([
        {
          known: Boolean(input.page.industry && targetIndustries.length),
          pass:
            !targetIndustries.length ||
            targetIndustries.some((value) =>
              input.page.industry?.toLowerCase().includes(value.toLowerCase()),
            ),
        },
        {
          known: Boolean(input.page.country && targetCountries.length),
          pass:
            !targetCountries.length ||
            targetCountries.some((value) =>
              input.page.country?.toLowerCase().includes(value.toLowerCase()),
            ),
        },
        ...firmographics.requiredKeywords.map((keyword) => ({
          known: true,
          pass: keywordHit(text, keyword),
        })),
      ]);

      const personaIds =
        assignment.personaIdsOverride?.length
          ? assignment.personaIdsOverride
          : strategy.personaIds;
      const persona = bestPersona(
        input.personas.filter((item) => personaIds.includes(item.id)),
        input.page,
        matchedSignals,
      );
      if (persona.excludedTitle) {
        disqualifiers.push(`Excluded persona title: ${persona.excludedTitle}`);
      }

      const dimensions = [
        { score: intentScore, weight: 60 },
        { score: firmographicScore, weight: 25 },
        { score: persona.score, weight: 15 },
      ].filter((dimension): dimension is { score: number; weight: number } => dimension.score != null);
      const availableWeight = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
      const baseScore = availableWeight
        ? dimensions.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0) /
          availableWeight
        : 0;
      const assignmentBonus = Math.min(
        5,
        (assignment.assignmentType === "primary" ? 2 : 0) +
          Math.max(0, assignment.priority) * 0.5 +
          Math.max(0, assignment.allocationPct) / 50,
      );
      const disqualified = disqualifiers.length > 0;
      const score = disqualified ? 0 : Math.min(100, Math.round(baseScore + assignmentBonus));
      const evidenceCoverage = Math.min(1, input.page.text.length / 1200);
      const confidenceValue = (availableWeight / 100) * 0.7 + evidenceCoverage * 0.3;

      return {
        strategyId: strategy.id,
        strategyName: strategy.name,
        strategyVersion: strategy.version,
        strategyAssignmentId: assignment.id,
        assignmentType: assignment.assignmentType,
        score,
        confidence:
          confidenceValue >= 0.75 ? "high" : confidenceValue >= 0.45 ? "medium" : "low",
        matchedSignalIds: links
          .filter((link) => matchedSignals.has(link.signalId))
          .map((link) => link.signalId),
        missingRequiredSignalIds,
        personaId: persona.persona?.id,
        personaName: persona.persona?.name,
        opportunityLabel: input.quality.primaryOpportunity?.label,
        disqualified,
        disqualifiers,
        evidence,
        breakdown: {
          intent: intentScore,
          firmographic: firmographicScore,
          persona: persona.score,
          assignmentBonus,
        },
      };
    })
    .filter((match): match is AssignedStrategyMatch => Boolean(match))
    .sort((left, right) => right.score - left.score);
}
