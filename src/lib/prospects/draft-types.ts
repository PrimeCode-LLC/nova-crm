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

export type ProspectDraft = {
  id: string;
  organizationId: string;
  userId: string;
  status: "active" | "completed" | "discarded";
  fields: Partial<Record<ProspectDraftFieldKey, ProspectDraftField>>;
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
  completedAt?: string;
  leadId?: string;
  discardedAt?: string;
  discardReason?: string;
};

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
