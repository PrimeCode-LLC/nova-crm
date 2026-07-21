import type { MatchEvidence, TextBlock } from "./text-match";

export type LeadTemperature = "cold" | "warm" | "hot";
export type IntentSignalQualificationRole = "demand" | "supporting";
export type IntentScoringMode = "absolute" | "normalized";
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

export type IntentSignalDefinition = {
  id: string;
  label: string;
  category: IntentSignalCategory;
  points: number;
  enabled: boolean;
  keywords: string[];
  labelNames?: string[];
  industries?: string[];
  fieldKeys?: IntentScanFieldKey[];
  qualificationRole?: IntentSignalQualificationRole;
};

export type IntentPlaybook = {
  templateId: string;
  name: string;
  outreachThreshold: number;
  tempBands: { warmMin: number; hotMin: number };
  autoTemperature: boolean;
  signals: IntentSignalDefinition[];
  engagement: { reply: number; multiTouch: number; multiTouchMin: number };
  scoringMode?: IntentScoringMode;
  qualification?: {
    requireDemandSignal: boolean;
    minCategories: number;
    partnerSearchSignalIds: string[];
    maxHiringPoints: number;
    maxWebsitePoints: number;
    maxOperationalPainPoints: number;
    maxSupportingBundlePoints: number;
    supportingBundleSignalIds: string[];
  };
  opportunityRoutes?: {
    id: string;
    label: string;
    signalIds: string[];
  }[];
  updatedAt?: string;
};

export type QualityScoreInput = Partial<
  Record<Exclude<IntentScanFieldKey, "toolsUsed">, string>
> & {
  toolsUsed?: string[];
  lastReplyAt?: string;
  touches?: number;
  labelIds?: string[];
};

export type QualityMatchedSignal = {
  signalId: string;
  label: string;
  category: IntentSignalCategory;
  points: number;
  reason: string;
  qualificationRole?: IntentSignalQualificationRole;
  evidence?: MatchEvidence;
};

export type QualityScoreResult = {
  score: number;
  rawPoints: number;
  maxRawPoints: number;
  matchedSignals: QualityMatchedSignal[];
  signalCount: number;
  meetsThreshold: boolean;
  suggestedTemperature: LeadTemperature;
  density: "none" | "weak" | "good" | "excellent";
  qualificationNotes: string[];
  primaryOpportunity?: {
    id: string;
    label: string;
    points: number;
    triggerSignalId?: string;
    triggerLabel?: string;
    triggerReason?: string;
  };
};

export type QualityScoreOptions = {
  labelNames?: string[];
  evidenceBlocks?: readonly TextBlock[];
};
