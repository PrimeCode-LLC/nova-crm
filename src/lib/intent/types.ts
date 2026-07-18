import type { LeadTemperature } from "@/lib/types";

/** Built-in playbook templates orgs can apply. */
export type IntentPlaybookTemplateId =
  | "stellix_soft"
  | "modernization_services"
  | "saas_outbound"
  | "logistics_tech"
  | "blank";

export type IntentSignalCategory =
  | "hiring"
  | "legacy_stack"
  | "digital_transformation"
  | "funding"
  | "expansion"
  | "supply_chain"
  | "technology"
  | "operational_pain"
  | "compliance"
  | "website"
  | "engagement"
  | "custom";

/**
 * `demand` = project / pain / partner-search (can help qualify).
 * `supporting` = hiring, funding, expansion, leadership, stack presence alone cannot qualify.
 */
export type IntentSignalQualificationRole = "demand" | "supporting";

/** One configurable detector in an org Intent Playbook. */
export type IntentSignalDefinition = {
  id: string;
  label: string;
  category: IntentSignalCategory;
  /** Points contributed when this signal matches (raw, before normalize / caps). */
  points: number;
  enabled: boolean;
  /** Case-insensitive substrings matched against research text, tools, labels, industry. */
  keywords: string[];
  /** Match CRM label names (case-insensitive). Leave blank until labels are standardized. */
  labelNames?: string[];
  /** Match company industry substrings. */
  industries?: string[];
  /** Which lead fields to scan for keywords (defaults to research + tools). */
  fieldKeys?: IntentScanFieldKey[];
  /** Defaults to `demand`. Supporting signals cannot independently qualify outreach. */
  qualificationRole?: IntentSignalQualificationRole;
};

export type IntentScanFieldKey =
  | "triggerEvent"
  | "painPoints"
  | "businessFocus"
  | "hiringSignals"
  | "recentNews"
  | "psLine"
  | "toolsUsed"
  | "notes"
  | "companyIndustry"
  | "contactTitle";

export type IntentEngagementBoosts = {
  /** Points when an inbound reply was detected. */
  reply: number;
  /** Points when touches >= threshold. */
  multiTouch: number;
  multiTouchMin: number;
};

/** Absolute = sum points capped at 100. Normalized = % of max possible enabled points. */
export type IntentScoringMode = "absolute" | "normalized";

/** Caps and gates for outreach-ready qualification (Stellix Soft style). */
export type IntentQualificationRules = {
  /** Require at least one demand-role signal to be outreach-ready. */
  requireDemandSignal: boolean;
  /**
   * Minimum distinct non-engagement categories among matched signals.
   * Bypassed when a `partnerSearchSignalIds` signal matches.
   */
  minCategories: number;
  /** Signal ids that count as verified RFP / partner-search (bypass minCategories). */
  partnerSearchSignalIds: string[];
  /** Max points from hiring category after match. */
  maxHiringPoints: number;
  /** Max points from website category. */
  maxWebsitePoints: number;
  /** Max points from operational_pain category. */
  maxOperationalPainPoints: number;
  /** Max combined points from funding + expansion + leadership (custom supporting) + stack supporting. */
  maxSupportingBundlePoints: number;
  /** Signal ids treated as “supporting bundle” for the combined cap (in addition to funding/expansion/hiring). */
  supportingBundleSignalIds: string[];
};

export type IntentOpportunityRoute = {
  id: string;
  label: string;
  /** Signal ids that feed this primary opportunity. */
  signalIds: string[];
};

/** Org-level Intent Playbook — drives Quality Score. */
export type IntentPlaybook = {
  templateId: IntentPlaybookTemplateId;
  name: string;
  /** Soft gate: warn (don't block) when score is below this (0–100). */
  outreachThreshold: number;
  /** Map normalized/absolute score → temperature when auto-temp is enabled. */
  tempBands: {
    warmMin: number;
    hotMin: number;
  };
  /** When true, derived temp overwrites lead.temperature unless manually locked. */
  autoTemperature: boolean;
  signals: IntentSignalDefinition[];
  engagement: IntentEngagementBoosts;
  /** Default `absolute` for Stellix-style playbooks; older templates may use `normalized`. */
  scoringMode?: IntentScoringMode;
  qualification?: IntentQualificationRules;
  /** Maps matched signals → one primary outreach angle. */
  opportunityRoutes?: IntentOpportunityRoute[];
  updatedAt?: string;
};

export type QualityMatchedSignal = {
  signalId: string;
  label: string;
  category: IntentSignalCategory;
  /** Points after caps. */
  points: number;
  /** Why it matched (keyword, label, industry, engagement). */
  reason: string;
  qualificationRole?: IntentSignalQualificationRole;
};

export type PrimaryOpportunity = {
  id: string;
  label: string;
  /** Sum of matched route signal points (after caps). */
  points: number;
  /** Trigger signal used for messaging angle. */
  triggerSignalId?: string;
  triggerLabel?: string;
  triggerReason?: string;
};

export type QualityScoreResult = {
  /** Final Quality Score 0–100. */
  score: number;
  /** Sum of matched points after caps (before absolute/normalized finalization). */
  rawPoints: number;
  /** Max possible raw points from enabled signals + engagement (normalized mode). */
  maxRawPoints: number;
  matchedSignals: QualityMatchedSignal[];
  signalCount: number;
  meetsThreshold: boolean;
  suggestedTemperature: LeadTemperature;
  density: "none" | "weak" | "good" | "excellent";
  /** Why outreach-ready failed when score is high enough but gates block. */
  qualificationNotes: string[];
  primaryOpportunity?: PrimaryOpportunity;
};

/** Persisted snapshot on Lead (optional; UI also computes live). */
export type LeadQualitySnapshot = {
  qualityScore?: number;
  qualitySignalCount?: number;
  qualityMatchedSignalIds?: string[];
  qualityScoredAt?: string;
  primaryOpportunityId?: string;
  primaryOpportunityLabel?: string;
  /** When set, auto-temperature will not overwrite `temperature`. */
  temperatureLocked?: boolean;
};
