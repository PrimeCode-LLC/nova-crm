import {
  COMPANY_SIZES,
  PIPELINE_STAGES,
  PRIORITY_TONE,
  REVENUE_RANGES,
  TEMPERATURE_TONE,
} from "@/lib/constants";
import { PROSPECT_REJECTION_REASONS } from "@/lib/prospecting-strategy/qualify";

export const PROSPECT_IMPORT_TEMPLATE_VERSION = "2.0";
export const PROSPECT_IMPORT_MAX_ROWS = 10_000;
export const PROSPECT_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const PROSPECT_IMPORT_DATA_SHEET = "Data";

export type ImportFieldType =
  | "text"
  | "email"
  | "url"
  | "domain"
  | "integer"
  | "number"
  | "boolean"
  | "date"
  | "enum"
  | "list"
  | "json";

export type ImportEntity = "account" | "contact" | "lead" | "routing";

export type ProspectImportField = {
  key: string;
  header: string;
  section: string;
  entity: ImportEntity;
  type: ImportFieldType;
  description: string;
  required?: boolean;
  values?: readonly string[];
};

const channelValues = [
  "cold_email",
  "personalized_email",
  "linkedin_outbound",
  "linkedin_1to1",
  "website_form",
  "upwork",
  "job_apply",
] as const;
const revenueValues = Object.keys(REVENUE_RANGES);
const stageValues = PIPELINE_STAGES.map((value) => value.key);
const temperatureValues = Object.keys(TEMPERATURE_TONE);
const priorityValues = Object.keys(PRIORITY_TONE);
const rejectionReasonValues = PROSPECT_REJECTION_REASONS.map((reason) => reason.value);

/**
 * Official import columns mirror the New prospect form.
 * Company Domain stays optional for account identity when Website / Company Email cannot derive it.
 */
const PROSPECT_IMPORT_FIELD_DEFINITIONS = [
  { key: "companyName", header: "Company Name", section: "Company", entity: "account", type: "text", required: true, description: "Legal or public company name." },
  { key: "companyDomain", header: "Company Domain", section: "Company", entity: "account", type: "domain", description: "Optional bare domain (acme.com). If blank, derived from Website URL or Company Email." },
  { key: "industry", header: "Industry", section: "Company", entity: "account", type: "text", description: "Company industry or vertical." },
  { key: "businessDescription", header: "Business Description", section: "Company", entity: "account", type: "text", description: "Short description of the business." },
  { key: "city", header: "City", section: "Company", entity: "account", type: "text", description: "Company city." },
  { key: "state", header: "State or Region", section: "Company", entity: "account", type: "text", description: "Company state or region." },
  { key: "country", header: "Country", section: "Company", entity: "account", type: "text", description: "Company country." },
  { key: "website", header: "Website URL", section: "Company", entity: "account", type: "url", description: "Full company website URL." },
  { key: "companyLinkedIn", header: "Company LinkedIn URL", section: "Company", entity: "account", type: "url", description: "Full LinkedIn company URL." },
  { key: "yearFounded", header: "Year Founded", section: "Company", entity: "account", type: "integer", description: "Four-digit founding year." },
  { key: "businessStatus", header: "Business Status", section: "Company", entity: "account", type: "enum", values: ["active", "new", "dormant"], description: "Current business status." },
  { key: "companySize", header: "Company Size", section: "Company", entity: "account", type: "enum", values: COMPANY_SIZES, description: "Allowed company-size key." },
  { key: "revenueRange", header: "Revenue Range", section: "Company", entity: "account", type: "enum", values: revenueValues, description: "Allowed estimated revenue-range key." },
  { key: "websiteStatus", header: "Website Status", section: "Company", entity: "account", type: "enum", values: ["live", "under_construction", "none"], description: "Current website status." },
  { key: "onlineActivityScore", header: "Online Activity Score", section: "Company", entity: "account", type: "enum", values: ["low", "medium", "high"], description: "Low, medium, or high." },
  { key: "lastWebsiteActivityAt", header: "Last Website Activity Date", section: "Company", entity: "account", type: "date", description: "Date in YYYY-MM-DD format." },
  { key: "lastWebsiteActivityNote", header: "Last Website Activity Note", section: "Company", entity: "account", type: "text", description: "Observation about recent website activity." },
  { key: "techStack", header: "Tech Stack", section: "Company", entity: "account", type: "list", description: "Semicolon-separated technologies." },
  { key: "careersPageUrl", header: "Careers Page URL", section: "Company", entity: "account", type: "url", description: "Full careers page URL." },

  { key: "firstName", header: "First Name", section: "Contact", entity: "contact", type: "text", required: true, description: "Contact first name." },
  { key: "lastName", header: "Last Name", section: "Contact", entity: "contact", type: "text", required: true, description: "Contact last name." },
  { key: "jobTitle", header: "Job Title", section: "Contact", entity: "contact", type: "text", description: "Contact job title." },
  { key: "seniority", header: "Seniority", section: "Contact", entity: "contact", type: "text", description: "Contact seniority." },
  { key: "contactLocation", header: "Contact Location", section: "Contact", entity: "contact", type: "text", description: "Contact location or timezone." },
  { key: "companyEmail", header: "Company Email", section: "Contact", entity: "contact", type: "email", description: "Company email; optional if another identity is present." },
  { key: "personalEmail", header: "Personal Email", section: "Contact", entity: "contact", type: "email", description: "Personal email; optional if another identity is present." },
  { key: "emailVerificationStatus", header: "Email Verification Status", section: "Contact", entity: "contact", type: "enum", values: ["not_verified", "verified", "bounced", "catch_all"], description: "Email verification status." },
  { key: "phone", header: "Phone", section: "Contact", entity: "contact", type: "text", description: "International phone number; optional if another identity is present." },
  { key: "contactSource", header: "Contact Source", section: "Contact", entity: "contact", type: "text", description: "Where the contact data came from." },
  { key: "bestContactChannel", header: "Best Contact Channel", section: "Contact", entity: "contact", type: "enum", values: ["email", "phone", "linkedin", "form"], description: "Preferred contact channel." },
  { key: "contactLinkedIn", header: "Contact LinkedIn URL", section: "Contact", entity: "contact", type: "url", description: "LinkedIn profile; optional if another identity is present." },

  { key: "strategy", header: "Prospecting Strategy", section: "Strategy & Intake", entity: "routing", type: "text", description: "Existing prospecting strategy name or ID." },
  { key: "persona", header: "Buyer Persona", section: "Strategy & Intake", entity: "routing", type: "text", description: "Existing buyer persona name or ID." },
  { key: "channel", header: "Channel", section: "Strategy & Intake", entity: "lead", type: "enum", values: channelValues, description: "Intended prospecting channel." },
  { key: "profile", header: "Outreach Profile", section: "Strategy & Intake", entity: "routing", type: "text", description: "Existing outreach profile name or ID." },
  { key: "stage", header: "Stage", section: "Strategy & Intake", entity: "lead", type: "enum", values: stageValues, description: "Pipeline stage." },
  { key: "temperature", header: "Temperature", section: "Strategy & Intake", entity: "lead", type: "enum", values: temperatureValues, description: "Cold, warm, or hot." },
  { key: "priority", header: "Priority", section: "Strategy & Intake", entity: "lead", type: "enum", values: priorityValues, description: "Lead priority." },
  { key: "nextAction", header: "Next Action", section: "Strategy & Intake", entity: "lead", type: "text", description: "Recommended next action." },
  { key: "notes", header: "Notes", section: "Strategy & Intake", entity: "lead", type: "text", description: "Internal prospect notes." },

  { key: "triggerEvent", header: "Trigger Event", section: "Outreach", entity: "lead", type: "text", description: "Reason this prospect may need outreach now." },
  { key: "painPoints", header: "Pain Points", section: "Outreach", entity: "lead", type: "text", description: "Likely customer pain points." },
  { key: "doNotContact", header: "Do Not Contact", section: "Outreach", entity: "lead", type: "boolean", description: "True blocks outreach." },

  { key: "personalizationTrigger", header: "Personalization Trigger", section: "Qualify", entity: "lead", type: "text", description: "Personalization note: trigger." },
  { key: "personalizationLikelyImpact", header: "Personalization Likely Impact", section: "Qualify", entity: "lead", type: "text", description: "Personalization note: likely impact." },
  { key: "personalizationRelevantService", header: "Personalization Relevant Service", section: "Qualify", entity: "lead", type: "text", description: "Personalization note: relevant service." },
  { key: "personalizationSuggestedAngle", header: "Personalization Suggested Angle", section: "Qualify", entity: "lead", type: "text", description: "Personalization note: suggested angle." },
  { key: "primaryOpportunityLabel", header: "Primary Opportunity Label", section: "Qualify", entity: "lead", type: "text", description: "Primary opportunity label from qualify." },
  { key: "deeplyPersonalized", header: "Deeply Personalized", section: "Qualify", entity: "lead", type: "boolean", description: "True when outreach is deeply personalized." },
  { key: "prospectQualifyStatus", header: "Qualify Status", section: "Qualify", entity: "lead", type: "enum", values: ["incomplete", "completed", "rejected"], description: "Prospect qualify status." },
  { key: "rejectionReason", header: "Rejection Reason", section: "Qualify", entity: "lead", type: "enum", values: rejectionReasonValues, description: "Required when Qualify Status is rejected." },
  { key: "rejectionNote", header: "Rejection Note", section: "Qualify", entity: "lead", type: "text", description: "Optional note when rejected." },
  { key: "intentEvidence", header: "Intent Evidence JSON", section: "Qualify", entity: "lead", type: "json", description: "JSON array of intent evidence objects (optional)." },
] as const satisfies readonly ProspectImportField[];

export type ProspectImportFieldKey = (typeof PROSPECT_IMPORT_FIELD_DEFINITIONS)[number]["key"];
export const PROSPECT_IMPORT_FIELDS: readonly ProspectImportField[] =
  PROSPECT_IMPORT_FIELD_DEFINITIONS;
export type NormalizedProspectImportRow = Partial<Record<ProspectImportFieldKey, unknown>>;

export const PROSPECT_IMPORT_HEADERS = PROSPECT_IMPORT_FIELDS.map((field) => field.header);

export function assertProspectImportRegistry(): void {
  if (PROSPECT_IMPORT_FIELDS.length !== 53) {
    throw new Error(`Prospect import registry must contain 53 fields; found ${PROSPECT_IMPORT_FIELDS.length}.`);
  }
  const headers = new Set(PROSPECT_IMPORT_HEADERS);
  if (headers.size !== PROSPECT_IMPORT_HEADERS.length) {
    throw new Error("Prospect import registry contains duplicate headers.");
  }
}

assertProspectImportRegistry();
