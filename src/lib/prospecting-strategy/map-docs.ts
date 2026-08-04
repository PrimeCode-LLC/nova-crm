import { firestoreValueToIso } from "@/lib/firestore/timestamp-util";
import type {
  BuyerPersona,
  BuyerPersonaTitle,
  LinkedPlaybookSignal,
  ProspectingStrategy,
  QualityChecklistItem,
  StrategyAssignment,
  StrategyFirmographics,
} from "@/lib/prospecting-strategy/types";
import { emptyFirmographics } from "@/lib/prospecting-strategy/types";
import type { CompanySize, RevenueRange } from "@/lib/types";

function strArr(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((s) => s.trim());
}

function optStr(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  return t.length ? t : undefined;
}

function asTitles(raw: unknown): BuyerPersonaTitle[] {
  if (!Array.isArray(raw)) return [];
  const out: BuyerPersonaTitle[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const kind = row.kind;
    if (!title) continue;
    if (kind !== "approved" && kind !== "similar" && kind !== "excluded") continue;
    out.push({ title, kind });
  }
  return out;
}

export function mapBuyerPersona(id: string, raw: Record<string, unknown>): BuyerPersona {
  return {
    id,
    organizationId: String(raw.organizationId ?? ""),
    name: String(raw.name ?? ""),
    description: optStr(raw.description),
    department: optStr(raw.department),
    seniority: optStr(raw.seniority),
    titles: asTitles(raw.titles),
    industries: strArr(raw.industries),
    countries: strArr(raw.countries),
    companySizeMin: raw.companySizeMin as CompanySize | undefined,
    companySizeMax: raw.companySizeMax as CompanySize | undefined,
    responsibilities: strArr(raw.responsibilities),
    businessGoals: strArr(raw.businessGoals),
    painPoints: strArr(raw.painPoints),
    buyingTriggers: strArr(raw.buyingTriggers),
    objections: strArr(raw.objections),
    relevantServices: strArr(raw.relevantServices),
    relevantSignalIds: strArr(raw.relevantSignalIds),
    recommendedAngle: optStr(raw.recommendedAngle),
    valueProposition: optStr(raw.valueProposition),
    callToAction: optStr(raw.callToAction),
    personalizationNotes: optStr(raw.personalizationNotes),
    goodExamples: optStr(raw.goodExamples),
    badExamples: optStr(raw.badExamples),
    priority: typeof raw.priority === "number" ? raw.priority : 0,
    active: raw.active !== false,
    createdBy: String(raw.createdBy ?? ""),
    createdAt: firestoreValueToIso(raw.createdAt),
    updatedAt: firestoreValueToIso(raw.updatedAt),
  };
}

function asFirmographics(raw: unknown): StrategyFirmographics {
  if (!raw || typeof raw !== "object") return emptyFirmographics();
  const f = raw as Record<string, unknown>;
  return {
    targetIndustries: strArr(f.targetIndustries),
    excludedIndustries: strArr(f.excludedIndustries),
    targetCountries: strArr(f.targetCountries),
    excludedCountries: strArr(f.excludedCountries),
    targetRegions: strArr(f.targetRegions),
    companySizeMin: f.companySizeMin as CompanySize | undefined,
    companySizeMax: f.companySizeMax as CompanySize | undefined,
    revenueMin: f.revenueMin as RevenueRange | undefined,
    revenueMax: f.revenueMax as RevenueRange | undefined,
    requiredKeywords: strArr(f.requiredKeywords),
    excludedKeywords: strArr(f.excludedKeywords),
    companyExamples: optStr(f.companyExamples),
    disqualifiedExamples: optStr(f.disqualifiedExamples),
  };
}

function asLinkedSignals(raw: unknown): LinkedPlaybookSignal[] {
  if (!Array.isArray(raw)) return [];
  const out: LinkedPlaybookSignal[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const signalId = typeof row.signalId === "string" ? row.signalId : "";
    if (!signalId) continue;
    out.push({
      signalId,
      enabled: row.enabled !== false,
      priority: typeof row.priority === "number" ? row.priority : 0,
      recencyDays: typeof row.recencyDays === "number" ? row.recencyDays : undefined,
      required: Boolean(row.required),
      instructions: optStr(row.instructions),
      strength: row.strength === "strong" || row.strength === "medium" ? row.strength : undefined,
      messageAngle: optStr(row.messageAngle),
    });
  }
  return out;
}

function asSearchTemplates(raw: unknown): ProspectingStrategy["searchTemplates"] {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<ProspectingStrategy["searchTemplates"]> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const label = typeof row.label === "string" ? row.label : "";
    const queries = strArr(row.queries);
    if (!id || !label) continue;
    out.push({ id, label, queries });
  }
  return out.length ? out : undefined;
}

function asDailyTargets(raw: unknown): ProspectingStrategy["dailyTargets"] {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const num = (k: string) => (typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : undefined);
  return {
    completed: num("completed") ?? 150,
    uniqueCompanies: num("uniqueCompanies") ?? 90,
    maxContactsPerCompany: num("maxContactsPerCompany") ?? 2,
    verifiedEmails: num("verifiedEmails") ?? 135,
    withEvidence: num("withEvidence") ?? 150,
    withRecentSignal: num("withRecentSignal") ?? 150,
    warm: num("warm") ?? 40,
    hot: num("hot") ?? 15,
    deeplyPersonalized: num("deeplyPersonalized") ?? 15,
  };
}

function asIndustryAllocations(raw: unknown): ProspectingStrategy["industryAllocations"] {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<ProspectingStrategy["industryAllocations"]> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const label = typeof row.label === "string" ? row.label.trim() : "";
    const target = typeof row.target === "number" ? row.target : 0;
    if (!label) continue;
    out.push({ label, target });
  }
  return out.length ? out : undefined;
}

function asChecklist(raw: unknown): QualityChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  const out: QualityChecklistItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const fieldKey = typeof row.fieldKey === "string" ? row.fieldKey : "";
    const label = typeof row.label === "string" ? row.label : fieldKey;
    const requirement = row.requirement;
    if (!id || !fieldKey) continue;
    if (requirement !== "required" && requirement !== "optional" && requirement !== "not_needed") {
      continue;
    }
    out.push({
      id,
      fieldKey,
      label,
      requirement,
      instructions: optStr(row.instructions),
      sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : 0,
    });
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder);
}

export function mapProspectingStrategy(id: string, raw: Record<string, unknown>): ProspectingStrategy {
  const status = raw.status;
  const safeStatus =
    status === "draft" || status === "published" || status === "paused" || status === "archived"
      ? status
      : "draft";

  return {
    id,
    organizationId: String(raw.organizationId ?? ""),
    name: String(raw.name ?? ""),
    description: optStr(raw.description),
    objective: optStr(raw.objective),
    missionBlurb: optStr(raw.missionBlurb),
    ownerId: String(raw.ownerId ?? ""),
    status: safeStatus,
    priority: typeof raw.priority === "number" ? raw.priority : 0,
    personaIds: strArr(raw.personaIds),
    firmographics: asFirmographics(raw.firmographics),
    linkedSignals: asLinkedSignals(raw.linkedSignals),
    qualityChecklist: asChecklist(raw.qualityChecklist),
    sopMarkdown: optStr(raw.sopMarkdown),
    researchNotes: optStr(raw.researchNotes),
    searchTemplates: asSearchTemplates(raw.searchTemplates),
    dailyTargets: asDailyTargets(raw.dailyTargets),
    industryAllocations: asIndustryAllocations(raw.industryAllocations),
    dailyTargetDefault:
      typeof raw.dailyTargetDefault === "number" && Number.isFinite(raw.dailyTargetDefault)
        ? raw.dailyTargetDefault
        : 150,
    audienceTimezone: (() => {
      const tz = optStr(raw.audienceTimezone);
      return tz || undefined;
    })(),
    sendWindowStartHour:
      typeof raw.sendWindowStartHour === "number" && Number.isFinite(raw.sendWindowStartHour)
        ? Math.min(23, Math.max(0, Math.floor(raw.sendWindowStartHour)))
        : undefined,
    sendWindowEndHour:
      typeof raw.sendWindowEndHour === "number" && Number.isFinite(raw.sendWindowEndHour)
        ? Math.min(24, Math.max(1, Math.floor(raw.sendWindowEndHour)))
        : undefined,
    version: typeof raw.version === "number" ? raw.version : 1,
    createdBy: String(raw.createdBy ?? ""),
    updatedBy: String(raw.updatedBy ?? ""),
    createdAt: firestoreValueToIso(raw.createdAt),
    updatedAt: firestoreValueToIso(raw.updatedAt),
    publishedAt: raw.publishedAt ? firestoreValueToIso(raw.publishedAt) : undefined,
  };
}

export function mapStrategyAssignment(id: string, raw: Record<string, unknown>): StrategyAssignment {
  const assignmentType = raw.assignmentType === "secondary" ? "secondary" : "primary";
  const status =
    raw.status === "paused" || raw.status === "ended" || raw.status === "active"
      ? raw.status
      : "active";

  return {
    id,
    organizationId: String(raw.organizationId ?? ""),
    strategyId: String(raw.strategyId ?? ""),
    userId: String(raw.userId ?? ""),
    assignmentType,
    priority: typeof raw.priority === "number" ? raw.priority : 0,
    allocationPct: typeof raw.allocationPct === "number" ? raw.allocationPct : 0,
    targetOverride:
      typeof raw.targetOverride === "number" && Number.isFinite(raw.targetOverride)
        ? raw.targetOverride
        : undefined,
    geographyOverride: strArr(raw.geographyOverride).length
      ? strArr(raw.geographyOverride)
      : undefined,
    industryOverride: strArr(raw.industryOverride).length
      ? strArr(raw.industryOverride)
      : undefined,
    personaIdsOverride: strArr(raw.personaIdsOverride).length
      ? strArr(raw.personaIdsOverride)
      : undefined,
    startDate: raw.startDate ? firestoreValueToIso(raw.startDate) : undefined,
    endDate: raw.endDate ? firestoreValueToIso(raw.endDate) : undefined,
    status,
    notes: optStr(raw.notes),
    assignedBy: String(raw.assignedBy ?? ""),
    createdAt: firestoreValueToIso(raw.createdAt),
    updatedAt: firestoreValueToIso(raw.updatedAt),
  };
}
