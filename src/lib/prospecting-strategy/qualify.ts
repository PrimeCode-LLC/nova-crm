import type { ISODate } from "@/lib/types";

/** Strong signals can qualify alone; medium need a second category. */
export type IntentEvidenceStrength = "strong" | "medium";

export type IntentEvidence = {
  id: string;
  /** Short label, e.g. "New distribution center". */
  label: string;
  /** Free category for grouping medium-signal rules. */
  category: string;
  strength: IntentEvidenceStrength;
  sourceUrl: string;
  /** Observation / publication date (ISO or YYYY-MM-DD). */
  observedAt: string;
  explanation: string;
  /** Optional link to org Intent Playbook signal id. */
  signalId?: string;
};

/** Fixed personalization structure from prospecting SOPs. */
export type PersonalizationNote = {
  trigger: string;
  likelyImpact: string;
  relevantService: string;
  suggestedAngle: string;
};

export type ProspectQualifyStatus = "incomplete" | "completed" | "rejected";

export type ProspectRejectionReason =
  | "company_too_small"
  | "wrong_industry"
  | "wrong_geography"
  | "no_physical_operations"
  | "no_relevant_decision_maker"
  | "no_verified_email"
  | "no_recent_intent_signal"
  | "signal_too_old"
  | "signal_not_verifiable"
  | "generic_keyword_match"
  | "duplicate_company"
  | "duplicate_contact"
  | "existing_client"
  | "existing_opportunity"
  | "previously_unsubscribed"
  | "competitor"
  | "no_service_fit"
  | "low_quality_score"
  | "other";

export const PROSPECT_REJECTION_REASONS: {
  value: ProspectRejectionReason;
  label: string;
}[] = [
  { value: "company_too_small", label: "Company too small" },
  { value: "wrong_industry", label: "Wrong industry" },
  { value: "wrong_geography", label: "Wrong geography" },
  { value: "no_physical_operations", label: "No physical operations" },
  { value: "no_relevant_decision_maker", label: "No relevant decision-maker" },
  { value: "no_verified_email", label: "No verified email" },
  { value: "no_recent_intent_signal", label: "No recent intent signal" },
  { value: "signal_too_old", label: "Signal too old" },
  { value: "signal_not_verifiable", label: "Signal not verifiable" },
  { value: "generic_keyword_match", label: "Generic keyword match" },
  { value: "duplicate_company", label: "Duplicate company" },
  { value: "duplicate_contact", label: "Duplicate contact" },
  { value: "existing_client", label: "Existing client" },
  { value: "existing_opportunity", label: "Existing opportunity" },
  { value: "previously_unsubscribed", label: "Previously unsubscribed" },
  { value: "competitor", label: "Competitor" },
  { value: "no_service_fit", label: "No clear Stellix Soft service fit" },
  { value: "low_quality_score", label: "Low quality score" },
  { value: "other", label: "Other" },
];

export function formatPersonalizationNote(note: PersonalizationNote): string {
  return [
    `Trigger:\n${note.trigger.trim()}`,
    `Likely impact:\n${note.likelyImpact.trim()}`,
    `Relevant Stellix Soft service:\n${note.relevantService.trim()}`,
    `Suggested outreach angle:\n${note.suggestedAngle.trim()}`,
  ].join("\n\n");
}

export function personalizationIsComplete(note: PersonalizationNote | undefined): boolean {
  if (!note) return false;
  return (
    note.trigger.trim().length > 0 &&
    note.likelyImpact.trim().length > 0 &&
    note.relevantService.trim().length > 0 &&
    note.suggestedAngle.trim().length > 0
  );
}

/** Calendar-day age. Same calendar day = 0; future dates are negative. */
export function evidenceAgeDays(observedAt: string, now = new Date()): number | null {
  const raw = observedAt.trim();
  if (!raw) return null;
  // Prefer YYYY-MM-DD (what <input type="date"> stores). Avoid local-noon math that
  // treats "today" as age -1 before noon.
  const day = raw.length >= 10 ? raw.slice(0, 10) : raw;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const localDayMs = (d: Date) =>
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  if (!m) {
    const t = Date.parse(raw);
    if (Number.isNaN(t)) return null;
    return Math.floor((localDayMs(now) - localDayMs(new Date(t))) / (24 * 60 * 60 * 1000));
  }
  const observedDay = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.floor((localDayMs(now) - observedDay) / (24 * 60 * 60 * 1000));
}

export function evidenceIsComplete(e: IntentEvidence): boolean {
  return (
    e.label.trim().length > 0 &&
    e.category.trim().length > 0 &&
    (e.strength === "strong" || e.strength === "medium") &&
    e.sourceUrl.trim().length > 0 &&
    e.observedAt.trim().length > 0 &&
    e.explanation.trim().length > 8
  );
}

/** 1 strong OR 2 medium from different categories. */
export function evidencePassesStrengthRule(
  evidence: IntentEvidence[],
  maxAgeDays = 180,
  now = new Date(),
): boolean {
  return summarizeEvidenceMatch(evidence, maxAgeDays, now).passes;
}

export type EvidenceSignalStatus = "matched" | "incomplete" | "stale" | "future";

export type EvidenceMatchSummary = {
  passes: boolean;
  /** Complete signals within the age window that count toward the rule. */
  matched: IntentEvidence[];
  strongCount: number;
  mediumCategoryCount: number;
  /** Human-readable match line, e.g. "1 strong matched". */
  matchLabel: string;
  statusById: Record<string, EvidenceSignalStatus>;
};

/** Classify each signal and summarize how many count toward the qualify rule. */
export function summarizeEvidenceMatch(
  evidence: IntentEvidence[],
  maxAgeDays = 180,
  now = new Date(),
): EvidenceMatchSummary {
  const statusById: Record<string, EvidenceSignalStatus> = {};
  const matched: IntentEvidence[] = [];

  for (const e of evidence) {
    if (!evidenceIsComplete(e)) {
      statusById[e.id] = "incomplete";
      continue;
    }
    const age = evidenceAgeDays(e.observedAt, now);
    if (age == null || age < 0) {
      statusById[e.id] = "future";
      continue;
    }
    if (age > maxAgeDays) {
      statusById[e.id] = "stale";
      continue;
    }
    statusById[e.id] = "matched";
    matched.push(e);
  }

  const strongCount = matched.filter((e) => e.strength === "strong").length;
  const mediumCategoryCount = new Set(
    matched.filter((e) => e.strength === "medium").map((e) => e.category.trim().toLowerCase()),
  ).size;
  const passes = strongCount >= 1 || mediumCategoryCount >= 2;

  let matchLabel = "0 signals matched";
  if (strongCount >= 1) {
    matchLabel =
      strongCount === 1 ? "1 strong matched" : `${strongCount} strong matched`;
  } else if (mediumCategoryCount >= 2) {
    matchLabel = `${mediumCategoryCount} medium categories matched`;
  } else if (matched.length > 0) {
    matchLabel = `${matched.length} signal${matched.length === 1 ? "" : "s"} (need 1 strong or 2 medium categories)`;
  }

  return {
    passes,
    matched,
    strongCount,
    mediumCategoryCount,
    matchLabel,
    statusById,
  };
}

/**
 * Collapse accidental double-paste company names like "AveniAveni" → "Aveni".
 * Only when the string is an exact concatenation of the same half (case-insensitive).
 */
export function collapseAccidentalDoubleName(name: string): string {
  const t = name.trim().replace(/\s+/g, " ");
  if (t.length < 4) return t;
  const mid = Math.floor(t.length / 2);
  if (t.length % 2 === 0) {
    const a = t.slice(0, mid);
    const b = t.slice(mid);
    if (a.toLowerCase() === b.toLowerCase()) return a;
  }
  // Also handle "Aveni Aveni"
  const parts = t.split(" ");
  if (parts.length === 2 && parts[0]!.toLowerCase() === parts[1]!.toLowerCase()) {
    return parts[0]!;
  }
  return t;
}

export type QualifyGateInput = {
  companyName?: string;
  companyWebsite?: string;
  contactName?: string;
  contactTitle?: string;
  contactLinkedIn?: string;
  emailVerified?: boolean;
  intentEvidence?: IntentEvidence[];
  personalizationNote?: PersonalizationNote;
  primaryOpportunityLabel?: string;
  qualityScore?: number;
  outreachThreshold?: number;
  doNotContact?: boolean;
  prospectQualifyStatus?: ProspectQualifyStatus;
  /** Soft: company already has this many contacts from researcher. */
  existingContactsForCompany?: number;
  maxContactsPerCompany?: number;
};

export type QualifyIssue = {
  code: string;
  message: string;
  blocking: boolean;
};

/**
 * Phase 1.5 qualify gate - blocking issues prevent "completed" status.
 * Soft issues (duplicates density) warn but do not block unless over hard max.
 */
export function evaluateQualifyGate(input: QualifyGateInput): {
  ok: boolean;
  issues: QualifyIssue[];
} {
  const issues: QualifyIssue[] = [];
  const threshold = input.outreachThreshold ?? 45;

  if (input.doNotContact) {
    issues.push({
      code: "do_not_contact",
      message: "Prospect is marked do-not-contact",
      blocking: true,
    });
  }
  if (!input.companyName?.trim()) {
    issues.push({ code: "company_name", message: "Company name is required", blocking: true });
  }
  if (!input.companyWebsite?.trim()) {
    issues.push({
      code: "company_website",
      message: "Company website is required",
      blocking: true,
    });
  }
  if (!input.contactName?.trim()) {
    issues.push({ code: "contact_name", message: "Contact full name is required", blocking: true });
  }
  if (!input.contactTitle?.trim()) {
    issues.push({
      code: "contact_title",
      message: "Job title is required (must match an approved persona)",
      blocking: true,
    });
  }
  if (!input.contactLinkedIn?.trim()) {
    issues.push({
      code: "contact_linkedin",
      message: "Contact LinkedIn URL is required",
      blocking: true,
    });
  }
  if (!input.emailVerified) {
    issues.push({
      code: "verified_email",
      message: "Verified business email is required",
      blocking: true,
    });
  }
  if (!evidencePassesStrengthRule(input.intentEvidence ?? [])) {
    const summary = summarizeEvidenceMatch(input.intentEvidence ?? []);
    issues.push({
      code: "intent_evidence",
      message:
        summary.matched.length > 0
          ? `${summary.matchLabel}. Need one strong signal or two medium signals from different categories (with URL, date, and explanation)`
          : "Need one strong signal or two medium signals from different categories (with URL, date, and explanation)",
      blocking: true,
    });
  }
  if (!personalizationIsComplete(input.personalizationNote)) {
    issues.push({
      code: "personalization",
      message: "Complete Trigger / Likely impact / Service / Angle personalization",
      blocking: true,
    });
  }
  if (!input.primaryOpportunityLabel?.trim()) {
    issues.push({
      code: "opportunity",
      message: "Primary opportunity type is required",
      blocking: true,
    });
  }
  if (input.qualityScore != null && input.qualityScore < threshold) {
    issues.push({
      code: "quality_score",
      message: `Quality score ${input.qualityScore} is below outreach threshold ${threshold}`,
      blocking: true,
    });
  }

  const maxContacts = input.maxContactsPerCompany ?? 2;
  const existing = input.existingContactsForCompany ?? 0;
  if (existing >= maxContacts) {
    issues.push({
      code: "max_contacts",
      message: `This company already has ${existing} contacts (max ${maxContacts}). Only add a second contact for a different buying function.`,
      blocking: true,
    });
  } else if (existing === maxContacts - 1) {
    issues.push({
      code: "second_contact",
      message: "Second contact for this company - ensure a different buying function (ops vs IT).",
      blocking: false,
    });
  }

  const blocking = issues.filter((i) => i.blocking);
  return { ok: blocking.length === 0, issues };
}

export function newEvidenceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `ev-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `ev-${Date.now()}`;
}

export type StrategySearchTemplate = {
  id: string;
  label: string;
  queries: string[];
};

export type StrategyDailyTargets = {
  completed: number;
  uniqueCompanies: number;
  maxContactsPerCompany: number;
  verifiedEmails: number;
  withEvidence: number;
  withRecentSignal: number;
  warm: number;
  hot: number;
  deeplyPersonalized: number;
};

export type StrategyIndustryAllocation = {
  label: string;
  target: number;
};

export const DEFAULT_DAILY_TARGETS: StrategyDailyTargets = {
  completed: 150,
  uniqueCompanies: 90,
  maxContactsPerCompany: 2,
  verifiedEmails: 135,
  withEvidence: 150,
  withRecentSignal: 150,
  warm: 40,
  hot: 15,
  deeplyPersonalized: 15,
};

export function emptyPersonalization(): PersonalizationNote {
  return { trigger: "", likelyImpact: "", relevantService: "", suggestedAngle: "" };
}

export function emptyEvidence(): IntentEvidence {
  return {
    id: newEvidenceId(),
    label: "",
    category: "",
    strength: "strong",
    sourceUrl: "",
    observedAt: "",
    explanation: "",
  };
}

/** Re-export ISODate for local consumers that need dates on evidence. */
export type { ISODate };
