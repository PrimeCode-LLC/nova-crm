import type { Lead, LeadTemperature } from "@/lib/types";
import type {
  IntentPlaybook,
  IntentScanFieldKey,
  IntentSignalDefinition,
  IntentSignalQualificationRole,
  PrimaryOpportunity,
  QualityMatchedSignal,
  QualityScoreResult,
} from "@/lib/intent/types";
import {
  corpusConcepts,
  findKeywordEvidence,
  firstMatchingKeyword,
  type TextBlock,
} from "@nova/scoring/text-match";

const DEFAULT_SCAN_FIELDS: IntentScanFieldKey[] = [
  "triggerEvent",
  "painPoints",
  "businessFocus",
  "hiringSignals",
  "recentNews",
  "psLine",
  "toolsUsed",
  "notes",
  "contactTitle",
];

export type QualityScoreLeadInput = Pick<
  Lead,
  | "triggerEvent"
  | "painPoints"
  | "businessFocus"
  | "hiringSignals"
  | "recentNews"
  | "psLine"
  | "toolsUsed"
  | "notes"
  | "companyIndustry"
  | "contactTitle"
  | "lastReplyAt"
  | "touches"
  | "labelIds"
>;

function fieldText(lead: QualityScoreLeadInput, key: IntentScanFieldKey): string {
  switch (key) {
    case "toolsUsed":
      return (lead.toolsUsed ?? []).join(" ");
    case "companyIndustry":
      return lead.companyIndustry ?? "";
    case "contactTitle":
      return lead.contactTitle ?? "";
    case "triggerEvent":
      return lead.triggerEvent ?? "";
    case "painPoints":
      return lead.painPoints ?? "";
    case "businessFocus":
      return lead.businessFocus ?? "";
    case "hiringSignals":
      return lead.hiringSignals ?? "";
    case "recentNews":
      return lead.recentNews ?? "";
    case "psLine":
      return lead.psLine ?? "";
    case "notes":
      return lead.notes ?? "";
    default:
      return "";
  }
}

function densityFor(count: number): QualityScoreResult["density"] {
  if (count <= 0) return "none";
  if (count === 1) return "weak";
  if (count === 2) return "good";
  return "excellent";
}

function temperatureFor(
  score: number,
  bands: IntentPlaybook["tempBands"],
): LeadTemperature {
  if (score >= bands.hotMin) return "hot";
  if (score >= bands.warmMin) return "warm";
  return "cold";
}

function roleOf(signal: IntentSignalDefinition): IntentSignalQualificationRole {
  return signal.qualificationRole ?? "demand";
}

function industryGatePasses(
  signal: IntentSignalDefinition,
  industryLower: string,
): boolean {
  if (!signal.industries?.length) return true;
  // No industry on the lead → don't block keyword matches.
  if (!industryLower) return true;
  return signal.industries.some((ind) => industryLower.includes(ind.toLowerCase()));
}

function applyCategoryCaps(
  matched: QualityMatchedSignal[],
  playbook: IntentPlaybook,
): QualityMatchedSignal[] {
  const q = playbook.qualification;
  if (!q) return matched;

  const caps: { category?: string; ids?: Set<string>; max: number; used: number }[] = [
    { category: "hiring", max: q.maxHiringPoints, used: 0 },
    { category: "website", max: q.maxWebsitePoints, used: 0 },
    { category: "operational_pain", max: q.maxOperationalPainPoints, used: 0 },
    {
      ids: new Set(q.supportingBundleSignalIds),
      max: q.maxSupportingBundlePoints,
      used: 0,
    },
  ];

  return matched.map((m) => {
    let points = m.points;
    for (const cap of caps) {
      const applies = cap.ids
        ? cap.ids.has(m.signalId)
        : m.category === cap.category;
      if (!applies) continue;
      const room = Math.max(0, cap.max - cap.used);
      const awarded = Math.min(points, room);
      cap.used += awarded;
      points = awarded;
    }
    return { ...m, points };
  });
}

function resolvePrimaryOpportunity(
  matched: QualityMatchedSignal[],
  playbook: IntentPlaybook,
): PrimaryOpportunity | undefined {
  const routes = playbook.opportunityRoutes;
  if (!routes?.length) return undefined;

  let best: PrimaryOpportunity | undefined;
  for (const route of routes) {
    const hits = matched.filter((m) => route.signalIds.includes(m.signalId));
    if (!hits.length) continue;
    const points = hits.reduce((s, h) => s + h.points, 0);
    const trigger = [...hits].sort((a, b) => b.points - a.points)[0];
    if (!best || points > best.points) {
      best = {
        id: route.id,
        label: route.label,
        points,
        triggerSignalId: trigger?.signalId,
        triggerLabel: trigger?.label,
        triggerReason: trigger?.reason,
      };
    }
  }
  return best;
}

function evaluateQualification(
  score: number,
  matched: QualityMatchedSignal[],
  playbook: IntentPlaybook,
): { meets: boolean; notes: string[] } {
  const notes: string[] = [];
  const threshold = playbook.outreachThreshold;
  if (score < threshold) {
    notes.push(`Score ${score} is below outreach threshold (${threshold}).`);
    return { meets: false, notes };
  }

  const q = playbook.qualification;
  if (!q) return { meets: true, notes };

  const nonEngagement = matched.filter((m) => m.category !== "engagement");
  const hasPartnerSearch = nonEngagement.some((m) =>
    q.partnerSearchSignalIds.includes(m.signalId),
  );
  const hasDemand = nonEngagement.some((m) => (m.qualificationRole ?? "demand") === "demand");

  if (q.requireDemandSignal && !hasDemand && !hasPartnerSearch) {
    notes.push(
      "Need a demand signal (project, pain, modernization, IoT, integration, etc.). Supporting signals alone cannot qualify.",
    );
  }

  const categories = new Set(nonEngagement.map((m) => m.category));
  if (!hasPartnerSearch && categories.size < q.minCategories) {
    notes.push(
      `Need signals from at least ${q.minCategories} categories (have ${categories.size}), unless a partner-search / RFP signal matches.`,
    );
  }

  return { meets: notes.length === 0, notes };
}

/**
 * Deterministic Quality Score from an Intent Playbook + lead research/labels/engagement.
 * Pure - safe for client and server.
 */
export function computeQualityScore(
  lead: QualityScoreLeadInput,
  playbook: IntentPlaybook,
  options?: {
    labelNames?: string[];
    evidenceBlocks?: readonly TextBlock[];
  },
): QualityScoreResult {
  const labelNamesLower = (options?.labelNames ?? []).map((n) => n.toLowerCase());
  const industryLower = (lead.companyIndustry ?? "").toLowerCase();
  const matchedRaw: QualityMatchedSignal[] = [];

  const enabled = playbook.signals.filter((s) => s.enabled);
  let maxRawPoints = enabled.reduce((sum, s) => sum + Math.max(0, s.points), 0);
  maxRawPoints += Math.max(0, playbook.engagement.reply);
  maxRawPoints += Math.max(0, playbook.engagement.multiTouch);
  if (maxRawPoints <= 0) maxRawPoints = 1;

  for (const signal of enabled) {
    if (!industryGatePasses(signal, industryLower)) continue;

    const fields = signal.fieldKeys?.length ? signal.fieldKeys : DEFAULT_SCAN_FIELDS;
    const corpus = fields
      .map((f) => fieldText(lead, f))
      .join("\n")
      .toLowerCase();
    const concepts = corpusConcepts(corpus);

    let reason = "";

    if (signal.keywords.length) {
      const hit = firstMatchingKeyword(corpus, concepts, signal.keywords);
      if (hit) reason = `Matched “${hit}”`;
    }

    if (!reason && signal.labelNames?.length && labelNamesLower.length) {
      const hit = signal.labelNames.find((ln) =>
        labelNamesLower.some((n) => n === ln.toLowerCase() || n.includes(ln.toLowerCase())),
      );
      if (hit) reason = `Label “${hit}”`;
    }

    if (reason) {
      matchedRaw.push({
        signalId: signal.id,
        label: signal.label,
        category: signal.category,
        points: Math.max(0, signal.points),
        reason,
        qualificationRole: roleOf(signal),
        evidence:
          reason.startsWith("Matched") && options?.evidenceBlocks?.length
            ? findKeywordEvidence(
                options.evidenceBlocks,
                reason.slice("Matched “".length, -1),
              )
            : undefined,
      });
    }
  }

  if (lead.lastReplyAt && playbook.engagement.reply > 0) {
    matchedRaw.push({
      signalId: "engagement_reply",
      label: "Inbound reply",
      category: "engagement",
      points: playbook.engagement.reply,
      reason: "Lead replied",
      qualificationRole: "supporting",
    });
  }

  const touches = typeof lead.touches === "number" ? lead.touches : 0;
  if (touches >= playbook.engagement.multiTouchMin && playbook.engagement.multiTouch > 0) {
    matchedRaw.push({
      signalId: "engagement_touches",
      label: "Multi-touch engagement",
      category: "engagement",
      points: playbook.engagement.multiTouch,
      reason: `${touches} touches`,
      qualificationRole: "supporting",
    });
  }

  const matched = applyCategoryCaps(matchedRaw, playbook);
  const rawPoints = matched.reduce((s, m) => s + m.points, 0);

  const mode = playbook.scoringMode ?? "absolute";
  const score =
    mode === "normalized"
      ? Math.min(100, Math.round((rawPoints / maxRawPoints) * 100))
      : Math.min(100, Math.round(rawPoints));

  const signalCount = matched.filter((m) => m.category !== "engagement").length;
  const { meets, notes } = evaluateQualification(score, matched, playbook);
  const primaryOpportunity = resolvePrimaryOpportunity(matched, playbook);

  return {
    score,
    rawPoints,
    maxRawPoints,
    matchedSignals: matched.filter((m) => m.points > 0 || m.category === "engagement"),
    signalCount,
    meetsThreshold: meets,
    suggestedTemperature: temperatureFor(score, playbook.tempBands),
    density: densityFor(signalCount),
    qualificationNotes: notes,
    primaryOpportunity,
  };
}

/** Fields that should trigger a quality rescore when patched. */
export const QUALITY_SCORE_PATCH_KEYS = [
  "triggerEvent",
  "painPoints",
  "businessFocus",
  "hiringSignals",
  "recentNews",
  "psLine",
  "toolsUsed",
  "notes",
  "companyIndustry",
  "contactTitle",
  "labelIds",
  "lastReplyAt",
  "touches",
] as const;

export function patchTouchesQualityFields(patch: Partial<Lead>): boolean {
  return QUALITY_SCORE_PATCH_KEYS.some((k) => k in patch);
}

export function buildQualityLeadPatch(
  lead: Lead,
  playbook: IntentPlaybook,
  labelNames: string[],
  options?: { forceTemperature?: boolean },
): Partial<Lead> {
  const result = computeQualityScore(lead, playbook, { labelNames });
  const out: Partial<Lead> = {
    qualityScore: result.score,
    qualitySignalCount: result.signalCount,
    qualityMatchedSignalIds: result.matchedSignals.map((m) => m.signalId),
    qualityScoredAt: new Date().toISOString(),
    primaryOpportunityId: result.primaryOpportunity?.id,
    primaryOpportunityLabel: result.primaryOpportunity?.label,
  };

  const locked = Boolean(lead.temperatureLocked);
  if (playbook.autoTemperature && (!locked || options?.forceTemperature)) {
    out.temperature = result.suggestedTemperature;
  }

  return out;
}

export function resolveLeadQuality(
  lead: Lead,
  playbook: IntentPlaybook,
  labelNames: string[],
): QualityScoreResult {
  return computeQualityScore(lead, playbook, { labelNames });
}

export function densityLabel(density: QualityScoreResult["density"]): string {
  switch (density) {
    case "none":
      return "No signals";
    case "weak":
      return "1 signal";
    case "good":
      return "2 signals";
    case "excellent":
      return "3+ signals";
  }
}
