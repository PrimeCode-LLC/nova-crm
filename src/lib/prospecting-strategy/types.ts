import type { CompanySize, ISODate, RevenueRange } from "@/lib/types";
import type {
  StrategyDailyTargets,
  StrategyIndustryAllocation,
  StrategySearchTemplate,
} from "@/lib/prospecting-strategy/qualify";
import { DEFAULT_DAILY_TARGETS } from "@/lib/prospecting-strategy/qualify";

/** Buyer / ICP persona - not an outreach Profile. */
export type BuyerPersonaTitleKind = "approved" | "similar" | "excluded";

export type BuyerPersonaTitle = {
  title: string;
  kind: BuyerPersonaTitleKind;
};

export type BuyerPersona = {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  department?: string;
  seniority?: string;
  titles: BuyerPersonaTitle[];
  industries: string[];
  countries: string[];
  companySizeMin?: CompanySize;
  companySizeMax?: CompanySize;
  responsibilities: string[];
  businessGoals: string[];
  painPoints: string[];
  buyingTriggers: string[];
  objections: string[];
  /** Free-text service labels relevant to this persona. */
  relevantServices: string[];
  /** Intent playbook signal ids that commonly apply. */
  relevantSignalIds: string[];
  recommendedAngle?: string;
  valueProposition?: string;
  callToAction?: string;
  personalizationNotes?: string;
  goodExamples?: string;
  badExamples?: string;
  priority: number;
  active: boolean;
  createdBy: string;
  createdAt: ISODate;
  updatedAt: ISODate;
};

export type ProspectingStrategyStatus =
  | "draft"
  | "published"
  | "paused"
  | "archived";

export type QualityChecklistRequirement = "required" | "optional" | "not_needed";

export type QualityChecklistItem = {
  id: string;
  /** Stable field key or custom label. */
  fieldKey: string;
  label: string;
  requirement: QualityChecklistRequirement;
  instructions?: string;
  sortOrder: number;
};

export type LinkedPlaybookSignal = {
  signalId: string;
  enabled: boolean;
  priority: number;
  /** Days; intent older than this should not qualify. */
  recencyDays?: number;
  required: boolean;
  instructions?: string;
  /** strong | medium for strategy-layer qualification guidance. */
  strength?: "strong" | "medium";
  messageAngle?: string;
};

export type StrategyFirmographics = {
  targetIndustries: string[];
  excludedIndustries: string[];
  targetCountries: string[];
  excludedCountries: string[];
  targetRegions: string[];
  companySizeMin?: CompanySize;
  companySizeMax?: CompanySize;
  revenueMin?: RevenueRange;
  revenueMax?: RevenueRange;
  requiredKeywords: string[];
  excludedKeywords: string[];
  companyExamples?: string;
  disqualifiedExamples?: string;
};

export type ProspectingStrategy = {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  objective?: string;
  /** Pinned mission shown at top of My Strategy. */
  missionBlurb?: string;
  ownerId: string;
  status: ProspectingStrategyStatus;
  priority: number;
  /** Buyer persona ids linked to this strategy. */
  personaIds: string[];
  firmographics: StrategyFirmographics;
  /** Subset of org Intent Playbook signals with strategy-specific settings. */
  linkedSignals: LinkedPlaybookSignal[];
  qualityChecklist: QualityChecklistItem[];
  /** Rich-text / markdown SOP. */
  sopMarkdown?: string;
  researchNotes?: string;
  /** Search query templates for the researcher workbench. */
  searchTemplates?: StrategySearchTemplate[];
  /** Multi-metric daily targets (Phase 1.5). */
  dailyTargets?: StrategyDailyTargets;
  /** Recommended industry mix for the day. */
  industryAllocations?: StrategyIndustryAllocation[];
  dailyTargetDefault: number;
  /**
   * IANA timezone for outbound email scheduling (audience / prospect clock).
   * When unset, schedule UIs fall back to the organization timezone.
   * Ops dashboards and mailbox daily quotas still use the org timezone.
   */
  audienceTimezone?: string;
  /** Soft send-window start hour (0–23) in audienceTimezone. Default 9. */
  sendWindowStartHour?: number;
  /** Soft send-window end hour (1–24, exclusive) in audienceTimezone. Default 12. */
  sendWindowEndHour?: number;
  /** Integer version bumped on publish. */
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  publishedAt?: ISODate;
};

export type StrategyAssignmentType = "primary" | "secondary";
export type StrategyAssignmentStatus = "active" | "paused" | "ended";

export type StrategyAssignment = {
  id: string;
  organizationId: string;
  strategyId: string;
  userId: string;
  assignmentType: StrategyAssignmentType;
  priority: number;
  /** Share of daily effort; active assignments for a user should total 100. */
  allocationPct: number;
  /** Overrides strategy.dailyTargetDefault when set. */
  targetOverride?: number;
  geographyOverride?: string[];
  industryOverride?: string[];
  personaIdsOverride?: string[];
  startDate?: ISODate;
  endDate?: ISODate;
  status: StrategyAssignmentStatus;
  notes?: string;
  assignedBy: string;
  createdAt: ISODate;
  updatedAt: ISODate;
};

export function emptyFirmographics(): StrategyFirmographics {
  return {
    targetIndustries: [],
    excludedIndustries: [],
    targetCountries: [],
    excludedCountries: [],
    targetRegions: [],
    requiredKeywords: [],
    excludedKeywords: [],
  };
}

export function resolveDailyTargets(
  strategy: Pick<ProspectingStrategy, "dailyTargets" | "dailyTargetDefault"> | undefined,
): StrategyDailyTargets {
  const base = { ...DEFAULT_DAILY_TARGETS };
  if (!strategy) return base;
  if (strategy.dailyTargets) {
    return { ...base, ...strategy.dailyTargets };
  }
  if (Number.isFinite(strategy.dailyTargetDefault)) {
    base.completed = strategy.dailyTargetDefault;
    base.withEvidence = strategy.dailyTargetDefault;
    base.withRecentSignal = strategy.dailyTargetDefault;
  }
  return base;
}

export type {
  StrategyDailyTargets,
  StrategyIndustryAllocation,
  StrategySearchTemplate,
};
