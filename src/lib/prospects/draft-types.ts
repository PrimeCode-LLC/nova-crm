import {
  emptyProspectForm,
  parseProspectForm,
  type ProspectFormValues,
} from "@/lib/prospects/prospect-form";

export const PROSPECT_DRAFT_FIELD_KEYS = [
  "companyName",
  "companyDomain",
  "companyWebsite",
  "companyLinkedIn",
  "industry",
  "businessDescription",
  "city",
  "state",
  "country",
  "yearFounded",
  "companySize",
  "revenueRange",
  "techStack",
  "contactName",
  "firstName",
  "lastName",
  "contactTitle",
  "contactEmail",
  "contactPhone",
  "contactLinkedIn",
  "triggerEvent",
  "painPoints",
  "businessFocus",
  "hiringSignals",
  "recentNews",
  "notes",
] as const;

export type ProspectDraftFieldKey = (typeof PROSPECT_DRAFT_FIELD_KEYS)[number];
export type ProspectDraftFieldStatus = "proposed" | "accepted" | "verified" | "conflict";

export type ProspectDraftEvidence = {
  sourceId: string;
  sourceUrl: string;
  quote: string;
};

export type ProspectDraftField = {
  value: string;
  confidence: number;
  status: ProspectDraftFieldStatus;
  evidence: ProspectDraftEvidence[];
  alternatives?: Array<{
    value: string;
    confidence: number;
    evidence: ProspectDraftEvidence[];
  }>;
  updatedAt: string;
};

export type ProspectDraftSourceSummary = {
  id: string;
  url: string;
  title: string;
  domain: string;
  capturedAt: string;
};

export type ProspectDraftOrigin = "manual" | "intent_radar";

export type ProspectDraft = {
  id: string;
  organizationId: string;
  userId: string;
  /** Monotonic optimistic-concurrency token. Legacy documents begin at revision 0. */
  revision: number;
  status: "active" | "completed" | "discarded";
  /** How this draft was started. Missing legacy values are inferred from captured sources. */
  origin: ProspectDraftOrigin;
  /** Stable launcher identifier, such as `prospects_page` or `fit_check`. */
  sourceContext?: string;
  /** Optional source entity id, such as the Fit Check scan that started the draft. */
  sourceReference?: string;
  /** Route the launcher expected to return to after saving. */
  destination?: string;
  fields: Partial<Record<ProspectDraftFieldKey, ProspectDraftField>>;
  /** Full Start Prospecting form state. Legacy drafts hydrate this from `fields`. */
  form?: ProspectFormValues;
  sources: ProspectDraftSourceSummary[];
  sourceCount: number;
  qualityScore?: number;
  qualityMatchedSignalIds?: string[];
  primaryOpportunityId?: string;
  primaryOpportunityLabel?: string;
  strategy?: {
    strategyId: string;
    strategyName: string;
    strategyVersion: number;
    strategyAssignmentId: string;
    personaId?: string;
    score: number;
    selectionMode: "auto" | "manual";
  };
  missingRequiredFields: ProspectDraftFieldKey[];
  completionPercent: number;
  createdAt: string;
  updatedAt: string;
  /** User-facing alias for the most recent acknowledged server save. */
  lastSavedAt: string;
  completedAt?: string;
  leadId?: string;
  discardedAt?: string;
  discardReason?: string;
};

export const DRAFT_FIELD_TO_FORM_KEY = {
  companyName: "bizName",
  companyWebsite: "website",
  companyLinkedIn: "companyLinkedin",
  industry: "industry",
  businessDescription: "bizDesc",
  city: "city",
  state: "state",
  country: "country",
  yearFounded: "yearFounded",
  companySize: "size",
  revenueRange: "rev",
  techStack: "techStackStr",
  firstName: "firstName",
  lastName: "lastName",
  contactTitle: "title",
  contactEmail: "email",
  contactPhone: "phone",
  contactLinkedIn: "linkedin",
  triggerEvent: "triggerEvent",
  painPoints: "painPoints",
  notes: "leadNotes",
} as const satisfies Partial<Record<ProspectDraftFieldKey, keyof ProspectFormValues>>;

/** Hydrate both current and pre-full-form drafts without a Firestore migration. */
export function prospectFormFromDraft(draft: ProspectDraft): ProspectFormValues {
  const stored = parseProspectForm(draft.form);
  const form = stored ?? emptyProspectForm();
  if (!stored) {
    for (const [draftKey, formKey] of Object.entries(DRAFT_FIELD_TO_FORM_KEY) as Array<
      [keyof typeof DRAFT_FIELD_TO_FORM_KEY, keyof ProspectFormValues]
    >) {
      const value = draft.fields[draftKey]?.value;
      if (value) {
        // Draft AI fields are strings; every mapped form target is string-valued.
        (form as unknown as Record<string, unknown>)[formKey] = value;
      }
    }
    const contactName = draft.fields.contactName?.value.trim();
    if (contactName && !form.firstName && !form.lastName) {
      const [firstName = "", ...lastName] = contactName.split(/\s+/);
      form.firstName = firstName;
      form.lastName = lastName.join(" ");
    }
    if (draft.strategy) {
      form.strategyId = draft.strategy.strategyId;
      form.strategyAssignmentId = draft.strategy.strategyAssignmentId;
      form.strategyVersion = draft.strategy.strategyVersion;
      form.personaId = draft.strategy.personaId ?? "";
    }
    form.qualifyForm.primaryOpportunityLabel = draft.primaryOpportunityLabel ?? "";
  }
  return form;
}

export const PROSPECT_DRAFT_REQUIRED_FIELDS: ProspectDraftFieldKey[] = [
  "companyName",
  "contactName",
];

export function normalizeProspectDraftFieldValue(
  key: ProspectDraftFieldKey,
  rawValue: string,
): string {
  let value = rawValue
    .trim()
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
  if (!value) return "";
  if (key === "contactEmail") return value.toLocaleLowerCase();
  if (key === "companyDomain") {
    return value
      .toLocaleLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0]!
      .replace(/\.$/, "");
  }
  if (
    key === "companyWebsite" ||
    key === "companyLinkedIn" ||
    key === "contactLinkedIn"
  ) {
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    try {
      const url = new URL(value);
      if (url.protocol === "http:" || url.protocol === "https:") {
        url.hash = "";
        return url.toString().replace(/\/$/, "");
      }
    } catch {
      return value;
    }
  }
  if (key === "yearFounded") {
    const match = value.match(/\b(18|19|20)\d{2}\b/);
    if (match) return match[0];
  }
  return value;
}

/** Verify only fields the reviewer explicitly submitted; untouched AI metadata is preserved. */
export function applyReviewedDraftValues(
  current: Partial<Record<ProspectDraftFieldKey, ProspectDraftField>>,
  values: Partial<Record<ProspectDraftFieldKey, string>>,
  updatedAt = new Date().toISOString(),
): Partial<Record<ProspectDraftFieldKey, ProspectDraftField>> {
  const fields = { ...current };
  for (const [key, rawValue] of Object.entries(values)) {
    const fieldKey = key as ProspectDraftFieldKey;
    if (!PROSPECT_DRAFT_FIELD_KEYS.includes(fieldKey)) continue;
    const value = normalizeProspectDraftFieldValue(fieldKey, rawValue ?? "");
    if (!value) {
      delete fields[fieldKey];
      continue;
    }
    fields[fieldKey] = {
      value,
      confidence: 1,
      status: "verified",
      evidence: fields[fieldKey]?.evidence ?? [],
      updatedAt,
    };
  }
  return fields;
}

export function draftCompletion(
  fields: Partial<Record<ProspectDraftFieldKey, ProspectDraftField>>,
): { missingRequiredFields: ProspectDraftFieldKey[]; completionPercent: number } {
  const usable = (key: ProspectDraftFieldKey) => {
    const field = fields[key];
    return Boolean(field?.value.trim()) && field?.status !== "conflict";
  };
  const missingRequiredFields = PROSPECT_DRAFT_REQUIRED_FIELDS.filter((key) => !usable(key));
  const usefulFields: ProspectDraftFieldKey[] = [
    ...PROSPECT_DRAFT_REQUIRED_FIELDS,
    "companyDomain",
    "companyWebsite",
    "industry",
    "contactTitle",
    "contactEmail",
    "contactLinkedIn",
    "triggerEvent",
    "painPoints",
  ];
  const complete = usefulFields.filter(usable).length;
  return {
    missingRequiredFields,
    completionPercent: Math.round((complete / usefulFields.length) * 100),
  };
}

/** Project the durable full form into the review fields used by readiness and search. */
export function prospectDraftValuesFromForm(
  form: ProspectFormValues,
): Partial<Record<ProspectDraftFieldKey, string>> {
  const values: Partial<Record<ProspectDraftFieldKey, string>> = {};
  for (const [draftKey, formKey] of Object.entries(DRAFT_FIELD_TO_FORM_KEY) as Array<
    [keyof typeof DRAFT_FIELD_TO_FORM_KEY, keyof ProspectFormValues]
  >) {
    const value = form[formKey];
    if (typeof value === "string") {
      values[draftKey] = value === "__unset__" ? "" : value;
    }
  }
  const firstName = form.firstName.trim();
  const lastName = form.lastName.trim();
  values.contactName = firstName && lastName ? `${firstName} ${lastName}` : "";
  return values;
}

/** Readiness must include manual-form values, including legacy form-only drafts. */
export function draftCompletionForForm(
  fields: Partial<Record<ProspectDraftFieldKey, ProspectDraftField>>,
  form?: ProspectFormValues,
): { missingRequiredFields: ProspectDraftFieldKey[]; completionPercent: number } {
  if (!form) return draftCompletion(fields);
  return draftCompletion(
    applyReviewedDraftValues(fields, prospectDraftValuesFromForm(form), "1970-01-01T00:00:00.000Z"),
  );
}
