import type {
  BestContactChannel,
  BusinessStatus,
  ChannelKey,
  CompanySize,
  EmailVerificationStatus,
  LeadPriority,
  LeadTemperature,
  OnlineActivityScore,
  PipelineStage,
  RevenueRange,
  WebsiteStatus,
} from "@/lib/types";
import {
  emptyQualifyFormState,
  type ProspectQualifyFormState,
} from "@/components/prospecting/prospect-qualify-panel";

const UNSET = "__unset__" as const;

export const NEW_PROSPECT_DRAFT_VERSION = 1 as const;

export type NewProspectFormDraft = {
  v: typeof NEW_PROSPECT_DRAFT_VERSION;
  channel: ChannelKey;
  profileId: string;
  stage: PipelineStage;
  temperature: LeadTemperature;
  priority: LeadPriority;
  leadNotes: string;
  triggerEvent: string;
  painPoints: string;
  doNotContact: boolean;
  nextAction: string;
  showAdvancedCompany: boolean;
  strategyId: string;
  personaId: string;
  strategyAssignmentId: string;
  strategyVersion?: number;
  bizName: string;
  industry: string;
  bizDesc: string;
  city: string;
  state: string;
  country: string;
  yearFounded: string;
  bizStatus: typeof UNSET | BusinessStatus;
  size: typeof UNSET | CompanySize;
  rev: typeof UNSET | RevenueRange;
  website: string;
  companyLinkedin: string;
  webStatus: typeof UNSET | WebsiteStatus;
  techStackStr: string;
  activity: typeof UNSET | OnlineActivityScore;
  lastSiteAt: string;
  lastSiteNote: string;
  careersUrl: string;
  firstName: string;
  lastName: string;
  title: string;
  seniority: string;
  contactLocation: string;
  email: string;
  personalEmail: string;
  emailVerify: typeof UNSET | EmailVerificationStatus;
  phone: string;
  contactSource: string;
  bestChannel: typeof UNSET | BestContactChannel;
  linkedin: string;
  qualifyForm: ProspectQualifyFormState;
};

export function emptyNewProspectFormDraft(): NewProspectFormDraft {
  return {
    v: NEW_PROSPECT_DRAFT_VERSION,
    channel: "cold_email",
    profileId: "",
    stage: "new",
    temperature: "cold",
    priority: "medium",
    leadNotes: "",
    triggerEvent: "",
    painPoints: "",
    doNotContact: false,
    nextAction: "",
    showAdvancedCompany: false,
    strategyId: "",
    personaId: "",
    strategyAssignmentId: "",
    strategyVersion: undefined,
    bizName: "",
    industry: "",
    bizDesc: "",
    city: "",
    state: "",
    country: "",
    yearFounded: "",
    bizStatus: UNSET,
    size: UNSET,
    rev: UNSET,
    website: "",
    companyLinkedin: "",
    webStatus: UNSET,
    techStackStr: "",
    activity: UNSET,
    lastSiteAt: "",
    lastSiteNote: "",
    careersUrl: "",
    firstName: "",
    lastName: "",
    title: "",
    seniority: "",
    contactLocation: "",
    email: "",
    personalEmail: "",
    emailVerify: UNSET,
    phone: "",
    contactSource: "",
    bestChannel: UNSET,
    linkedin: "",
    qualifyForm: emptyQualifyFormState(),
  };
}

export function draftStorageKey(userId: string | undefined): string | null {
  if (!userId?.trim()) return null;
  return `crm:new-prospect-draft:v${NEW_PROSPECT_DRAFT_VERSION}:${userId.trim()}`;
}

export function loadNewProspectDraft(userId: string | undefined): NewProspectFormDraft | null {
  const key = draftStorageKey(userId);
  if (!key || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NewProspectFormDraft;
    if (parsed?.v !== NEW_PROSPECT_DRAFT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveNewProspectDraft(userId: string | undefined, draft: NewProspectFormDraft): void {
  const key = draftStorageKey(userId);
  if (!key || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* quota / private mode */
  }
}

export function clearNewProspectDraft(userId: string | undefined): void {
  const key = draftStorageKey(userId);
  if (!key || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function serializeNewProspectDraft(draft: NewProspectFormDraft): string {
  return JSON.stringify(draft);
}

export function mergePrefillIntoDraft(
  draft: NewProspectFormDraft,
  prefill?: {
    leadNotes?: string;
    channel?: ChannelKey;
    painPoints?: string;
    strategyId?: string;
    strategyAssignmentId?: string;
    strategyVersion?: number;
    personaId?: string;
  },
): NewProspectFormDraft {
  if (!prefill) return draft;
  return {
    ...draft,
    strategyId: draft.strategyId || prefill.strategyId || "",
    personaId: draft.personaId || prefill.personaId || "",
    strategyAssignmentId: draft.strategyAssignmentId || prefill.strategyAssignmentId || "",
    strategyVersion: draft.strategyVersion ?? prefill.strategyVersion,
    channel: draft.channel === "cold_email" && prefill.channel ? prefill.channel : draft.channel,
    leadNotes: draft.leadNotes.trim() ? draft.leadNotes : prefill.leadNotes ?? draft.leadNotes,
    painPoints: draft.painPoints.trim() ? draft.painPoints : prefill.painPoints ?? draft.painPoints,
  };
}

function qualifyIsEmpty(q: ProspectQualifyFormState): boolean {
  const empty = emptyQualifyFormState();
  if (q.primaryOpportunityLabel.trim()) return false;
  if (q.rejectionNote.trim()) return false;
  if (q.rejectionReason) return false;
  if (q.deeplyPersonalized) return false;
  if (q.qualifyStatus !== empty.qualifyStatus) return false;
  const evidenceEmpty = q.evidence.every(
    (row) =>
      !row.label.trim() &&
      !row.sourceUrl.trim() &&
      !row.category.trim() &&
      !row.explanation.trim() &&
      !row.observedAt.trim() &&
      !row.signalId,
  );
  if (!evidenceEmpty) return false;
  const p = q.personalization;
  if (
    p.trigger.trim() ||
    p.likelyImpact.trim() ||
    p.relevantService.trim() ||
    p.suggestedAngle.trim()
  ) {
    return false;
  }
  return true;
}

/** True when the draft matches an untouched new-prospect form. */
export function isNewProspectFormDraftEmpty(draft: NewProspectFormDraft): boolean {
  if (draft.strategyId || draft.personaId || draft.strategyAssignmentId) return false;
  if (draft.showAdvancedCompany) return false;
  if (!qualifyIsEmpty(draft.qualifyForm)) return false;

  const empty = emptyNewProspectFormDraft();
  const keys = Object.keys(empty) as (keyof NewProspectFormDraft)[];
  for (const key of keys) {
    if (key === "v" || key === "qualifyForm" || key === "strategyVersion") continue;
    if (draft[key] !== empty[key]) return false;
  }
  return true;
}
