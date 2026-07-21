import {
  corpusConcepts,
  findKeywordEvidence,
  firstMatchingKeyword,
} from "./text-match";
import type {
  IntentPlaybook,
  IntentScanFieldKey,
  IntentSignalDefinition,
  QualityMatchedSignal,
  QualityScoreInput,
  QualityScoreOptions,
  QualityScoreResult,
} from "./types";

const DEFAULT_SCAN_FIELDS: IntentScanFieldKey[] = [
  "triggerEvent", "painPoints", "businessFocus", "hiringSignals", "recentNews",
  "psLine", "toolsUsed", "notes", "contactTitle",
];

function fieldText(input: QualityScoreInput, key: IntentScanFieldKey): string {
  if (key === "toolsUsed") return input.toolsUsed?.join(" ") ?? "";
  return input[key] ?? "";
}

function densityFor(count: number): QualityScoreResult["density"] {
  if (count <= 0) return "none";
  if (count === 1) return "weak";
  if (count === 2) return "good";
  return "excellent";
}

function temperatureFor(score: number, playbook: IntentPlaybook) {
  if (score >= playbook.tempBands.hotMin) return "hot" as const;
  if (score >= playbook.tempBands.warmMin) return "warm" as const;
  return "cold" as const;
}

function roleOf(signal: IntentSignalDefinition) {
  return signal.qualificationRole ?? "demand";
}

function applyCategoryCaps(
  matched: QualityMatchedSignal[],
  playbook: IntentPlaybook,
): QualityMatchedSignal[] {
  const rules = playbook.qualification;
  if (!rules) return matched;
  const caps: { category?: string; ids?: Set<string>; max: number; used: number }[] = [
    { category: "hiring", max: rules.maxHiringPoints, used: 0 },
    { category: "website", max: rules.maxWebsitePoints, used: 0 },
    { category: "operational_pain", max: rules.maxOperationalPainPoints, used: 0 },
    { ids: new Set(rules.supportingBundleSignalIds), max: rules.maxSupportingBundlePoints, used: 0 },
  ];
  return matched.map((match) => {
    let points = match.points;
    for (const cap of caps) {
      const applies = cap.ids ? cap.ids.has(match.signalId) : match.category === cap.category;
      if (!applies) continue;
      const awarded = Math.min(points, Math.max(0, cap.max - cap.used));
      cap.used += awarded;
      points = awarded;
    }
    return { ...match, points };
  });
}

function qualification(
  score: number,
  matched: QualityMatchedSignal[],
  playbook: IntentPlaybook,
): { meets: boolean; notes: string[] } {
  const notes: string[] = [];
  if (score < playbook.outreachThreshold) {
    notes.push(`Score ${score} is below outreach threshold (${playbook.outreachThreshold}).`);
    return { meets: false, notes };
  }
  const rules = playbook.qualification;
  if (!rules) return { meets: true, notes };
  const signals = matched.filter((match) => match.category !== "engagement");
  const partner = signals.some((match) => rules.partnerSearchSignalIds.includes(match.signalId));
  const demand = signals.some((match) => (match.qualificationRole ?? "demand") === "demand");
  if (rules.requireDemandSignal && !demand && !partner) {
    notes.push("Need a demand signal; supporting signals alone cannot qualify.");
  }
  const categories = new Set(signals.map((match) => match.category));
  if (!partner && categories.size < rules.minCategories) {
    notes.push(`Need signals from at least ${rules.minCategories} categories (have ${categories.size}).`);
  }
  return { meets: notes.length === 0, notes };
}

export function computeQualityScoreCore(
  input: QualityScoreInput,
  playbook: IntentPlaybook,
  options: QualityScoreOptions = {},
): QualityScoreResult {
  const labels = (options.labelNames ?? []).map((label) => label.toLowerCase());
  const industry = (input.companyIndustry ?? "").toLowerCase();
  const raw: QualityMatchedSignal[] = [];
  const enabled = playbook.signals.filter((signal) => signal.enabled);
  const maxRawPoints = Math.max(
    1,
    enabled.reduce((sum, signal) => sum + Math.max(0, signal.points), 0) +
      Math.max(0, playbook.engagement.reply) +
      Math.max(0, playbook.engagement.multiTouch),
  );

  for (const signal of enabled) {
    if (
      signal.industries?.length &&
      industry &&
      !signal.industries.some((value) => industry.includes(value.toLowerCase()))
    ) {
      continue;
    }
    const corpus = (signal.fieldKeys?.length ? signal.fieldKeys : DEFAULT_SCAN_FIELDS)
      .map((field) => fieldText(input, field))
      .join("\n")
      .toLowerCase();
    const hit = signal.keywords.length
      ? firstMatchingKeyword(corpus, corpusConcepts(corpus), signal.keywords)
      : undefined;
    const labelHit = !hit
      ? signal.labelNames?.find((candidate) =>
          labels.some(
            (label) =>
              label === candidate.toLowerCase() ||
              label.includes(candidate.toLowerCase()),
          ),
        )
      : undefined;
    if (!hit && !labelHit) continue;
    raw.push({
      signalId: signal.id,
      label: signal.label,
      category: signal.category,
      points: Math.max(0, signal.points),
      reason: hit ? `Matched “${hit}”` : `Label “${labelHit}”`,
      qualificationRole: roleOf(signal),
      evidence:
        hit && options.evidenceBlocks?.length
          ? findKeywordEvidence(options.evidenceBlocks, hit)
          : undefined,
    });
  }

  if (input.lastReplyAt && playbook.engagement.reply > 0) {
    raw.push({
      signalId: "engagement_reply",
      label: "Inbound reply",
      category: "engagement",
      points: playbook.engagement.reply,
      reason: "Lead replied",
      qualificationRole: "supporting",
    });
  }
  const touches = input.touches ?? 0;
  if (touches >= playbook.engagement.multiTouchMin && playbook.engagement.multiTouch > 0) {
    raw.push({
      signalId: "engagement_touches",
      label: "Multi-touch engagement",
      category: "engagement",
      points: playbook.engagement.multiTouch,
      reason: `${touches} touches`,
      qualificationRole: "supporting",
    });
  }

  const matched = applyCategoryCaps(raw, playbook);
  const rawPoints = matched.reduce((sum, match) => sum + match.points, 0);
  const score =
    (playbook.scoringMode ?? "absolute") === "normalized"
      ? Math.min(100, Math.round((rawPoints / maxRawPoints) * 100))
      : Math.min(100, Math.round(rawPoints));
  const signalCount = matched.filter((match) => match.category !== "engagement").length;
  const qualificationResult = qualification(score, matched, playbook);
  let primaryOpportunity: QualityScoreResult["primaryOpportunity"];
  for (const route of playbook.opportunityRoutes ?? []) {
    const routeMatches = matched.filter((match) => route.signalIds.includes(match.signalId));
    if (!routeMatches.length) continue;
    const points = routeMatches.reduce((sum, match) => sum + match.points, 0);
    const trigger = [...routeMatches].sort((a, b) => b.points - a.points)[0];
    if (!primaryOpportunity || points > primaryOpportunity.points) {
      primaryOpportunity = {
        id: route.id,
        label: route.label,
        points,
        triggerSignalId: trigger?.signalId,
        triggerLabel: trigger?.label,
        triggerReason: trigger?.reason,
      };
    }
  }

  return {
    score,
    rawPoints,
    maxRawPoints,
    matchedSignals: matched.filter((match) => match.points > 0 || match.category === "engagement"),
    signalCount,
    meetsThreshold: qualificationResult.meets,
    suggestedTemperature: temperatureFor(score, playbook),
    density: densityFor(signalCount),
    qualificationNotes: qualificationResult.notes,
    primaryOpportunity,
  };
}
