import { z } from "zod";

import {
  emptyEvidence,
  emptyPersonalization,
  evaluateQualifyGate,
  formatPersonalizationNote,
  type IntentEvidence,
  type PersonalizationNote,
  type ProspectQualifyStatus,
  type ProspectRejectionReason,
} from "@/lib/prospecting-strategy/qualify";
import type {
  Account,
  BestContactChannel,
  BusinessStatus,
  ChannelKey,
  CompanySize,
  Contact,
  EmailVerificationStatus,
  Lead,
  LeadPriority,
  LeadTemperature,
  OnlineActivityScore,
  PipelineStage,
  RevenueRange,
  WebsiteStatus,
} from "@/lib/types";

export const PROSPECT_FORM_VERSION = 2 as const;
export const PROSPECT_FORM_UNSET = "__unset__" as const;

export type ProspectQualifyFormState = {
  evidence: IntentEvidence[];
  personalization: PersonalizationNote;
  primaryOpportunityLabel: string;
  deeplyPersonalized: boolean;
  qualifyStatus: ProspectQualifyStatus;
  rejectionReason: ProspectRejectionReason | "";
  rejectionNote: string;
};

export type ProspectFormValues = {
  v: typeof PROSPECT_FORM_VERSION;
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
  bizStatus: typeof PROSPECT_FORM_UNSET | BusinessStatus;
  size: typeof PROSPECT_FORM_UNSET | CompanySize;
  rev: typeof PROSPECT_FORM_UNSET | RevenueRange;
  website: string;
  companyLinkedin: string;
  webStatus: typeof PROSPECT_FORM_UNSET | WebsiteStatus;
  techStackStr: string;
  activity: typeof PROSPECT_FORM_UNSET | OnlineActivityScore;
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
  emailVerify: typeof PROSPECT_FORM_UNSET | EmailVerificationStatus;
  phone: string;
  contactSource: string;
  bestChannel: typeof PROSPECT_FORM_UNSET | BestContactChannel;
  linkedin: string;
  qualifyForm: ProspectQualifyFormState;
};

export function emptyProspectQualifyForm(): ProspectQualifyFormState {
  return {
    evidence: [emptyEvidence()],
    personalization: emptyPersonalization(),
    primaryOpportunityLabel: "",
    deeplyPersonalized: false,
    qualifyStatus: "completed",
    rejectionReason: "",
    rejectionNote: "",
  };
}

export function emptyProspectForm(): ProspectFormValues {
  return {
    v: PROSPECT_FORM_VERSION,
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
    bizStatus: PROSPECT_FORM_UNSET,
    size: PROSPECT_FORM_UNSET,
    rev: PROSPECT_FORM_UNSET,
    website: "",
    companyLinkedin: "",
    webStatus: PROSPECT_FORM_UNSET,
    techStackStr: "",
    activity: PROSPECT_FORM_UNSET,
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
    emailVerify: PROSPECT_FORM_UNSET,
    phone: "",
    contactSource: "",
    bestChannel: PROSPECT_FORM_UNSET,
    linkedin: "",
    qualifyForm: emptyProspectQualifyForm(),
  };
}

const trimmedString = (max = 4000) => z.string().max(max);
const optionalSelect = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum([PROSPECT_FORM_UNSET, ...values] as [typeof PROSPECT_FORM_UNSET, ...T]);

const evidenceSchema = z.object({
  id: trimmedString(200),
  signalId: trimmedString(200).optional(),
  label: trimmedString(),
  category: trimmedString(500),
  strength: z.enum(["strong", "medium"]),
  observedAt: trimmedString(100),
  sourceUrl: trimmedString(),
  explanation: trimmedString(),
});

const personalizationSchema = z.object({
  trigger: trimmedString(),
  likelyImpact: trimmedString(),
  relevantService: trimmedString(),
  suggestedAngle: trimmedString(),
});

export const prospectFormSchema = z.object({
  v: z.literal(PROSPECT_FORM_VERSION),
  channel: trimmedString(100).transform((value) => value as ChannelKey),
  profileId: trimmedString(200),
  stage: z.enum(["new", "viewed", "contacted", "replied", "qualified", "discovery", "proposal", "negotiation"]),
  temperature: z.enum(["cold", "warm", "hot"]),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  leadNotes: trimmedString(),
  triggerEvent: trimmedString(),
  painPoints: trimmedString(),
  doNotContact: z.boolean(),
  nextAction: trimmedString(),
  showAdvancedCompany: z.boolean(),
  strategyId: trimmedString(200),
  personaId: trimmedString(200),
  strategyAssignmentId: trimmedString(200),
  strategyVersion: z.number().int().positive().optional(),
  bizName: trimmedString(500),
  industry: trimmedString(500),
  bizDesc: trimmedString(),
  city: trimmedString(500),
  state: trimmedString(500),
  country: trimmedString(500),
  yearFounded: trimmedString(20),
  bizStatus: optionalSelect(["active", "new", "dormant"] as const),
  size: optionalSelect(["solo", "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001+"] as const),
  rev: optionalSelect(["lt_1m", "1m_10m", "10m_50m", "50m_100m", "100m_500m", "500m_1b", "gt_1b", "unknown"] as const),
  website: trimmedString(),
  companyLinkedin: trimmedString(),
  webStatus: optionalSelect(["live", "under_construction", "none"] as const),
  techStackStr: trimmedString(),
  activity: optionalSelect(["low", "medium", "high"] as const),
  lastSiteAt: trimmedString(100),
  lastSiteNote: trimmedString(),
  careersUrl: trimmedString(),
  firstName: trimmedString(500),
  lastName: trimmedString(500),
  title: trimmedString(500),
  seniority: trimmedString(500),
  contactLocation: trimmedString(500),
  email: trimmedString(500),
  personalEmail: trimmedString(500),
  emailVerify: optionalSelect(["not_verified", "verified", "bounced", "catch_all"] as const),
  phone: trimmedString(200),
  contactSource: trimmedString(500),
  bestChannel: optionalSelect(["email", "phone", "linkedin", "form"] as const),
  linkedin: trimmedString(),
  qualifyForm: z.object({
    evidence: z.array(evidenceSchema).max(50),
    personalization: personalizationSchema,
    primaryOpportunityLabel: trimmedString(500),
    deeplyPersonalized: z.boolean(),
    qualifyStatus: z.enum(["incomplete", "completed", "rejected"]),
    rejectionReason: z.union([
      z.literal(""),
      z.enum([
        "company_too_small",
        "wrong_industry",
        "wrong_geography",
        "no_physical_operations",
        "no_relevant_decision_maker",
        "no_verified_email",
        "no_recent_intent_signal",
        "signal_too_old",
        "signal_not_verifiable",
        "generic_keyword_match",
        "duplicate_company",
        "duplicate_contact",
        "existing_client",
        "existing_opportunity",
        "previously_unsubscribed",
        "competitor",
        "no_service_fit",
        "low_quality_score",
        "other",
      ]),
    ]),
    rejectionNote: trimmedString(),
  }),
});

export function parseProspectForm(value: unknown): ProspectFormValues | null {
  const parsed = prospectFormSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function normalizedEmail(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function domainFromWebsiteOrEmail(website: string, email: string): string | undefined {
  const site = website.trim();
  if (site) {
    try {
      return new URL(site).hostname.toLocaleLowerCase().replace(/^www\./, "") || undefined;
    } catch {
      // Validation reports malformed URLs; email remains a useful fallback.
    }
  }
  const at = normalizedEmail(email).lastIndexOf("@");
  return at > 0 ? normalizedEmail(email).slice(at + 1) || undefined : undefined;
}

export function parseTechStack(value: string): string[] | undefined {
  const items = [...new Set(value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean))];
  return items.length ? items : undefined;
}

export function isoFromProspectDate(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function isValidOptionalHttpUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function evaluateOutreachReadiness(form: ProspectFormValues): string[] {
  if (form.doNotContact) return ["Outreach is blocked by do-not-contact"];
  const issues: string[] = [];
  if (!form.triggerEvent.trim()) issues.push("Add a trigger event");
  if (["cold_email", "personalized_email"].includes(form.channel) && !form.email.trim()) {
    issues.push("Add a company email");
  }
  if (["linkedin_outbound", "linkedin_1to1"].includes(form.channel) && !form.linkedin.trim()) {
    issues.push("Add a LinkedIn profile");
  }
  if (["upwork", "job_apply"].includes(form.channel) && !form.profileId) {
    issues.push("Select an outreach profile");
  }
  if (form.emailVerify === "bounced") issues.push("Replace the bounced email");
  return issues;
}

export type ProspectFormValidationContext = {
  existingContactsForCompany: number;
  maxContactsPerCompany: number;
  outreachThreshold: number;
};

export function validateProspectForm(
  form: ProspectFormValues,
  context: ProspectFormValidationContext,
): { errors: string[]; qualifyIssues: ReturnType<typeof evaluateQualifyGate>["issues"] } {
  const errors: string[] = [];
  if (!form.bizName.trim()) errors.push("Business name is required.");
  if (!form.firstName.trim() || !form.lastName.trim()) errors.push("First and last name are required.");
  const companyEmail = normalizedEmail(form.email);
  const personalEmail = normalizedEmail(form.personalEmail);
  if (companyEmail && personalEmail && companyEmail === personalEmail) {
    errors.push("Company and personal email must be different.");
  }
  const urls: Array<[string, string]> = [
    ["Website", form.website],
    ["Company LinkedIn", form.companyLinkedin],
    ["Careers page", form.careersUrl],
    ["Contact LinkedIn", form.linkedin],
  ];
  for (const [label, value] of urls) {
    if (!isValidOptionalHttpUrl(value)) errors.push(`${label} must be a complete http(s) URL.`);
  }
  if (form.yearFounded.trim()) {
    const year = Number(form.yearFounded);
    if (!Number.isInteger(year) || year < 1800 || year > new Date().getFullYear() + 1) {
      errors.push("Year founded should be a valid year.");
    }
  }
  if (form.lastSiteAt && new Date(`${form.lastSiteAt}T12:00:00`).getTime() > Date.now()) {
    errors.push("Last website activity cannot be in the future.");
  }
  if (form.qualifyForm.qualifyStatus === "rejected" && !form.qualifyForm.rejectionReason) {
    errors.push("Select a rejection reason.");
  }
  const qualify = evaluateQualifyGate({
    companyName: form.bizName.trim(),
    companyWebsite: form.website.trim(),
    contactName: `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
    contactTitle: form.title.trim(),
    contactLinkedIn: form.linkedin.trim(),
    emailVerified: form.emailVerify === "verified",
    intentEvidence: form.qualifyForm.evidence,
    personalizationNote: form.qualifyForm.personalization,
    primaryOpportunityLabel: form.qualifyForm.primaryOpportunityLabel,
    doNotContact: form.doNotContact,
    outreachThreshold: context.outreachThreshold,
    existingContactsForCompany: context.existingContactsForCompany,
    maxContactsPerCompany: context.maxContactsPerCompany,
  });
  return { errors, qualifyIssues: qualify.issues };
}

export type BuildProspectEntitiesInput = {
  form: ProspectFormValues;
  accountId: string;
  contactId: string;
  leadId: string;
  ownerId: string;
  now: string;
  qualifyAsIncomplete?: boolean;
  research?: {
    companyDomain?: string;
    businessFocus?: string;
    hiringSignals?: string;
    recentNews?: string;
  };
  quality?: {
    score?: number;
    matchedSignalIds?: string[];
    primaryOpportunityId?: string;
  };
  extensions?: Lead["extensions"];
};

export function buildProspectEntities(input: BuildProspectEntitiesInput): {
  account: Account;
  contact: Contact;
  lead: Lead;
} {
  const { form, ownerId, now } = input;
  const firstName = form.firstName.trim();
  const lastName = form.lastName.trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const domain =
    domainFromWebsiteOrEmail(form.website, form.email) ||
    input.research?.companyDomain?.trim().toLocaleLowerCase() ||
    undefined;
  const location = [form.city, form.state, form.country].map((part) => part.trim()).filter(Boolean).join(", ");
  const qualification =
    input.qualifyAsIncomplete && form.qualifyForm.qualifyStatus === "completed"
      ? "incomplete"
      : form.qualifyForm.qualifyStatus;
  const account: Account = {
    id: input.accountId,
    name: form.bizName.trim(),
    domain,
    industry: form.industry.trim() || undefined,
    businessDescription: form.bizDesc.trim() || undefined,
    city: form.city.trim() || undefined,
    state: form.state.trim() || undefined,
    country: form.country.trim() || undefined,
    location: location || undefined,
    yearFounded: form.yearFounded.trim() ? Number(form.yearFounded) : undefined,
    businessStatus: form.bizStatus === PROSPECT_FORM_UNSET ? undefined : form.bizStatus,
    size: form.size === PROSPECT_FORM_UNSET ? undefined : form.size,
    revenueRange: form.rev === PROSPECT_FORM_UNSET ? undefined : form.rev,
    website: form.website.trim() || undefined,
    linkedin: form.companyLinkedin.trim() || undefined,
    websiteStatus: form.webStatus === PROSPECT_FORM_UNSET ? undefined : form.webStatus,
    techStack: parseTechStack(form.techStackStr),
    onlineActivityScore: form.activity === PROSPECT_FORM_UNSET ? undefined : form.activity,
    lastWebsiteActivityAt: isoFromProspectDate(form.lastSiteAt),
    lastWebsiteActivityNote: form.lastSiteNote.trim() || undefined,
    careersPageUrl: form.careersUrl.trim() || undefined,
    contactCount: 1,
    leadCount: 1,
    openDealValue: 0,
    ownerId,
    createdAt: now,
    updatedAt: now,
  };
  const contact: Contact = {
    id: input.contactId,
    accountId: input.accountId,
    firstName,
    lastName,
    fullName,
    email: normalizedEmail(form.email) || undefined,
    personalEmail: normalizedEmail(form.personalEmail) || undefined,
    emailVerificationStatus:
      form.emailVerify === PROSPECT_FORM_UNSET ? undefined : form.emailVerify,
    emailVerificationSource:
      form.emailVerify === PROSPECT_FORM_UNSET ? undefined : ("manual" as const),
    phone: form.phone.trim() || undefined,
    title: form.title.trim() || undefined,
    seniority: form.seniority.trim() || undefined,
    location: form.contactLocation.trim() || undefined,
    linkedin: form.linkedin.trim() || undefined,
    contactSource: form.contactSource.trim() || undefined,
    bestContactChannel: form.bestChannel === PROSPECT_FORM_UNSET ? undefined : form.bestChannel,
    ownerId,
    createdAt: now,
    updatedAt: now,
  };
  const evidence = form.qualifyForm.evidence.filter((row) => row.label.trim() || row.sourceUrl.trim());
  const lead: Lead = {
    id: input.leadId,
    accountId: input.accountId,
    contactId: input.contactId,
    channel: form.channel,
    profileId: form.profileId || undefined,
    stage: form.stage,
    temperature: form.temperature,
    priority: form.priority,
    ownerId,
    createdById: ownerId,
    scraperId: ownerId,
    intakeKind: "prospect",
    prospectOwnerId: ownerId,
    prospectVisibility: "open",
    contactName: fullName,
    contactTitle: form.title.trim() || undefined,
    contactEmail: normalizedEmail(form.email) || undefined,
    contactLinkedIn: form.linkedin.trim() || undefined,
    companyName: form.bizName.trim(),
    companyDomain: domain,
    companyIndustry: form.industry.trim() || undefined,
    companySize: form.size === PROSPECT_FORM_UNSET ? undefined : form.size,
    revenueRange: form.rev === PROSPECT_FORM_UNSET ? undefined : form.rev,
    painPoints: form.painPoints.trim() || undefined,
    triggerEvent:
      form.triggerEvent.trim() || evidence.find((row) => row.label.trim())?.label || undefined,
    businessFocus: input.research?.businessFocus?.trim() || undefined,
    hiringSignals: input.research?.hiringSignals?.trim() || undefined,
    recentNews: input.research?.recentNews?.trim() || undefined,
    doNotContact: form.doNotContact,
    touches: 0,
    isIdle: false,
    notes: form.leadNotes.trim() || undefined,
    nextAction: form.nextAction.trim() || undefined,
    strategyId: form.strategyId || undefined,
    personaId: form.personaId || undefined,
    strategyVersion: form.strategyId ? form.strategyVersion : undefined,
    strategyAssignmentId: form.strategyId ? form.strategyAssignmentId || undefined : undefined,
    intentEvidence: evidence.length ? evidence : undefined,
    personalizationNote: form.qualifyForm.personalization,
    prospectQualifyStatus: qualification,
    rejectionReason:
      qualification === "rejected" && form.qualifyForm.rejectionReason
        ? form.qualifyForm.rejectionReason
        : undefined,
    rejectionNote:
      qualification === "rejected" ? form.qualifyForm.rejectionNote.trim() || undefined : undefined,
    deeplyPersonalized: form.qualifyForm.deeplyPersonalized || undefined,
    emailVerified: form.emailVerify === "verified" || undefined,
    primaryOpportunityId: input.quality?.primaryOpportunityId,
    primaryOpportunityLabel: form.qualifyForm.primaryOpportunityLabel.trim() || undefined,
    psLine: formatPersonalizationNote(form.qualifyForm.personalization).trim() || undefined,
    qualityScore: input.quality?.score,
    qualityMatchedSignalIds: input.quality?.matchedSignalIds,
    qualitySignalCount: input.quality?.matchedSignalIds?.length,
    qualityScoredAt: typeof input.quality?.score === "number" ? now : undefined,
    extensions: input.extensions,
    createdAt: now,
    updatedAt: now,
  };
  return { account, contact, lead };
}
