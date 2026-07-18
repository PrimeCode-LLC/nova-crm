import { defaultIntentPlaybook, INTENT_PLAYBOOK_TEMPLATES } from "@/lib/intent/playbook-templates";
import type {
  IntentOpportunityRoute,
  IntentPlaybook,
  IntentPlaybookTemplateId,
  IntentQualificationRules,
  IntentScanFieldKey,
  IntentScoringMode,
  IntentSignalCategory,
  IntentSignalDefinition,
  IntentSignalQualificationRole,
} from "@/lib/intent/types";

const TEMPLATE_IDS: IntentPlaybookTemplateId[] = [
  "stellix_soft",
  "modernization_services",
  "saas_outbound",
  "logistics_tech",
  "blank",
];

const CATEGORIES: IntentSignalCategory[] = [
  "hiring",
  "legacy_stack",
  "digital_transformation",
  "funding",
  "expansion",
  "supply_chain",
  "technology",
  "operational_pain",
  "compliance",
  "website",
  "engagement",
  "custom",
];

const FIELD_KEYS: IntentScanFieldKey[] = [
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
];

function asStringArray(raw: unknown, max = 80): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

function parseSignal(raw: unknown, index: number): IntentSignalDefinition | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id =
    typeof o.id === "string" && o.id.trim()
      ? o.id.trim().slice(0, 64)
      : `signal_${index + 1}`;
  const label =
    typeof o.label === "string" && o.label.trim()
      ? o.label.trim().slice(0, 80)
      : `Signal ${index + 1}`;
  const category =
    typeof o.category === "string" && CATEGORIES.includes(o.category as IntentSignalCategory)
      ? (o.category as IntentSignalCategory)
      : "custom";
  const points =
    typeof o.points === "number" && Number.isFinite(o.points)
      ? Math.max(0, Math.min(100, Math.round(o.points)))
      : 10;
  const fieldKeysRaw = Array.isArray(o.fieldKeys) ? o.fieldKeys : [];
  const fieldKeys = fieldKeysRaw.filter(
    (k): k is IntentScanFieldKey =>
      typeof k === "string" && FIELD_KEYS.includes(k as IntentScanFieldKey),
  );
  const labelNames = asStringArray(o.labelNames, 40);
  const industries = asStringArray(o.industries, 40);

  const signal: IntentSignalDefinition = {
    id,
    label,
    category,
    points,
    enabled: o.enabled !== false,
    keywords: asStringArray(o.keywords, 60),
  };
  if (labelNames.length) signal.labelNames = labelNames;
  if (industries.length) signal.industries = industries;
  if (fieldKeys.length) signal.fieldKeys = fieldKeys;
  if (o.qualificationRole === "demand" || o.qualificationRole === "supporting") {
    signal.qualificationRole = o.qualificationRole as IntentSignalQualificationRole;
  }
  return signal;
}

function parseQualification(raw: unknown): IntentQualificationRules | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  return {
    requireDemandSignal: o.requireDemandSignal !== false,
    minCategories:
      typeof o.minCategories === "number" ? Math.max(1, Math.min(8, Math.round(o.minCategories))) : 2,
    partnerSearchSignalIds: asStringArray(o.partnerSearchSignalIds, 20),
    maxHiringPoints:
      typeof o.maxHiringPoints === "number" ? Math.max(0, Math.min(100, o.maxHiringPoints)) : 10,
    maxWebsitePoints:
      typeof o.maxWebsitePoints === "number" ? Math.max(0, Math.min(100, o.maxWebsitePoints)) : 10,
    maxOperationalPainPoints:
      typeof o.maxOperationalPainPoints === "number"
        ? Math.max(0, Math.min(100, o.maxOperationalPainPoints))
        : 30,
    maxSupportingBundlePoints:
      typeof o.maxSupportingBundlePoints === "number"
        ? Math.max(0, Math.min(100, o.maxSupportingBundlePoints))
        : 15,
    supportingBundleSignalIds: asStringArray(o.supportingBundleSignalIds, 40),
  };
}

function parseRoutes(raw: unknown): IntentOpportunityRoute[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: IntentOpportunityRoute[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const label = typeof o.label === "string" ? o.label.trim() : "";
    const signalIds = asStringArray(o.signalIds, 30);
    if (!id || !label || !signalIds.length) continue;
    out.push({ id: id.slice(0, 64), label: label.slice(0, 80), signalIds });
  }
  return out.length ? out : undefined;
}

/** Normalize Firestore / API payload into a safe IntentPlaybook. */
export function parseIntentPlaybook(raw: unknown): IntentPlaybook {
  const fallback = defaultIntentPlaybook();
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;

  const templateId =
    typeof o.templateId === "string" &&
    TEMPLATE_IDS.includes(o.templateId as IntentPlaybookTemplateId)
      ? (o.templateId as IntentPlaybookTemplateId)
      : fallback.templateId;

  const templateDefaults = INTENT_PLAYBOOK_TEMPLATES[templateId]?.build();

  const signalsRaw = Array.isArray(o.signals) ? o.signals : fallback.signals;
  const signals = signalsRaw
    .map((s, i) => parseSignal(s, i))
    .filter((s): s is IntentSignalDefinition => s != null)
    .slice(0, 50);

  // Preserve qualificationRole from template when client save omitted it.
  if (templateDefaults?.signals.length) {
    const roleById = new Map(
      templateDefaults.signals.map((s) => [s.id, s.qualificationRole] as const),
    );
    for (const signal of signals) {
      if (!signal.qualificationRole && roleById.get(signal.id)) {
        signal.qualificationRole = roleById.get(signal.id);
      }
    }
  }

  const engagementRaw =
    o.engagement && typeof o.engagement === "object"
      ? (o.engagement as Record<string, unknown>)
      : {};
  const tempRaw =
    o.tempBands && typeof o.tempBands === "object"
      ? (o.tempBands as Record<string, unknown>)
      : {};

  const warmMin =
    typeof tempRaw.warmMin === "number" ? Math.max(0, Math.min(100, tempRaw.warmMin)) : 40;
  const hotMin =
    typeof tempRaw.hotMin === "number" ? Math.max(0, Math.min(100, tempRaw.hotMin)) : 70;

  const scoringMode: IntentScoringMode | undefined =
    o.scoringMode === "normalized" || o.scoringMode === "absolute"
      ? o.scoringMode
      : templateDefaults?.scoringMode;

  const playbook: IntentPlaybook = {
    templateId,
    name:
      typeof o.name === "string" && o.name.trim()
        ? o.name.trim().slice(0, 80)
        : fallback.name,
    outreachThreshold:
      typeof o.outreachThreshold === "number" && Number.isFinite(o.outreachThreshold)
        ? Math.max(0, Math.min(100, Math.round(o.outreachThreshold)))
        : 40,
    tempBands: {
      warmMin,
      hotMin: Math.max(warmMin, hotMin),
    },
    autoTemperature: o.autoTemperature !== false,
    signals: signals.length ? signals : fallback.signals,
    engagement: {
      reply:
        typeof engagementRaw.reply === "number"
          ? Math.max(0, Math.min(50, Math.round(engagementRaw.reply)))
          : fallback.engagement.reply,
      multiTouch:
        typeof engagementRaw.multiTouch === "number"
          ? Math.max(0, Math.min(50, Math.round(engagementRaw.multiTouch)))
          : fallback.engagement.multiTouch,
      multiTouchMin:
        typeof engagementRaw.multiTouchMin === "number"
          ? Math.max(1, Math.min(20, Math.round(engagementRaw.multiTouchMin)))
          : fallback.engagement.multiTouchMin,
    },
  };

  if (scoringMode) playbook.scoringMode = scoringMode;

  const qualification =
    parseQualification(o.qualification) ?? templateDefaults?.qualification;
  if (qualification) playbook.qualification = qualification;

  const routes = parseRoutes(o.opportunityRoutes) ?? templateDefaults?.opportunityRoutes;
  if (routes?.length) playbook.opportunityRoutes = routes;

  if (typeof o.updatedAt === "string" && o.updatedAt.trim()) {
    playbook.updatedAt = o.updatedAt;
  }
  return playbook;
}

/** Deep-clone playbook JSON without `undefined` (safe for Firestore writes). */
export function playbookForFirestore(playbook: IntentPlaybook): Record<string, unknown> {
  return JSON.parse(JSON.stringify(playbook)) as Record<string, unknown>;
}
