import {
  COMPANY_SIZES,
  PIPELINE_STAGES,
  PRIORITY_TONE,
  PUSH_STATUS_TONE,
  REVENUE_RANGES,
  TEMPERATURE_TONE,
} from "@/lib/constants";

export const PROSPECT_IMPORT_TEMPLATE_VERSION = "1.0";
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
const pushValues = Object.keys(PUSH_STATUS_TONE);

const PROSPECT_IMPORT_FIELD_DEFINITIONS = [
  { key: "recordType", header: "Record Type", section: "Company", entity: "lead", type: "enum", values: ["prospect"], description: "Always prospect for this importer." },
  { key: "companyName", header: "Company Name", section: "Company", entity: "account", type: "text", required: true, description: "Legal or public company name." },
  { key: "companyDomain", header: "Company Domain", section: "Company", entity: "account", type: "domain", required: true, description: "Bare company domain, for example acme.com." },
  { key: "industry", header: "Industry", section: "Company", entity: "account", type: "text", description: "Company industry or vertical." },
  { key: "businessDescription", header: "Business Description", section: "Company", entity: "account", type: "text", description: "Short description of the business." },
  { key: "companySize", header: "Company Size", section: "Company", entity: "account", type: "enum", values: COMPANY_SIZES, description: "Allowed company-size key." },
  { key: "revenueRange", header: "Revenue Range", section: "Company", entity: "account", type: "enum", values: revenueValues, description: "Allowed estimated revenue-range key." },
  { key: "companyLocation", header: "Company Location", section: "Company", entity: "account", type: "text", description: "Free-form company location." },
  { key: "city", header: "City", section: "Company", entity: "account", type: "text", description: "Company city." },
  { key: "state", header: "State or Region", section: "Company", entity: "account", type: "text", description: "Company state or region." },
  { key: "country", header: "Country", section: "Company", entity: "account", type: "text", description: "Company country." },
  { key: "yearFounded", header: "Year Founded", section: "Company", entity: "account", type: "integer", description: "Four-digit founding year." },
  { key: "businessStatus", header: "Business Status", section: "Company", entity: "account", type: "enum", values: ["active", "new", "dormant"], description: "Current business status." },
  { key: "website", header: "Website URL", section: "Company", entity: "account", type: "url", description: "Full company website URL." },
  { key: "websiteStatus", header: "Website Status", section: "Company", entity: "account", type: "enum", values: ["live", "under_construction", "none"], description: "Current website status." },
  { key: "companyLinkedIn", header: "Company LinkedIn URL", section: "Company", entity: "account", type: "url", description: "Full LinkedIn company URL." },
  { key: "techStack", header: "Tech Stack", section: "Company", entity: "account", type: "list", description: "Semicolon-separated technologies." },
  { key: "onlineActivityScore", header: "Online Activity Score", section: "Company", entity: "account", type: "enum", values: ["low", "medium", "high"], description: "Low, medium, or high." },
  { key: "lastWebsiteActivityAt", header: "Last Website Activity Date", section: "Company", entity: "account", type: "date", description: "Date in YYYY-MM-DD format." },
  { key: "lastWebsiteActivityNote", header: "Last Website Activity Note", section: "Company", entity: "account", type: "text", description: "Observation about recent website activity." },
  { key: "careersPageUrl", header: "Careers Page URL", section: "Company", entity: "account", type: "url", description: "Full careers page URL." },
  { key: "accountLabels", header: "Account Labels", section: "Company", entity: "routing", type: "list", description: "Semicolon-separated existing account labels." },

  { key: "firstName", header: "First Name", section: "Contact", entity: "contact", type: "text", required: true, description: "Contact first name." },
  { key: "lastName", header: "Last Name", section: "Contact", entity: "contact", type: "text", required: true, description: "Contact last name." },
  { key: "companyEmail", header: "Company Email", section: "Contact", entity: "contact", type: "email", description: "Company email; optional if another identity is present." },
  { key: "personalEmail", header: "Personal Email", section: "Contact", entity: "contact", type: "email", description: "Personal email; optional if another identity is present." },
  { key: "emailVerified", header: "Email Verified", section: "Contact", entity: "contact", type: "boolean", description: "True or false." },
  { key: "emailVerificationStatus", header: "Email Verification Status", section: "Contact", entity: "contact", type: "enum", values: ["not_verified", "verified", "bounced", "catch_all"], description: "Email verification status." },
  { key: "phone", header: "Phone", section: "Contact", entity: "contact", type: "text", description: "International phone number; optional if another identity is present." },
  { key: "contactLinkedIn", header: "Contact LinkedIn URL", section: "Contact", entity: "contact", type: "url", description: "LinkedIn profile; optional if another identity is present." },
  { key: "jobTitle", header: "Job Title", section: "Contact", entity: "contact", type: "text", description: "Contact job title." },
  { key: "seniority", header: "Seniority", section: "Contact", entity: "contact", type: "text", description: "Contact seniority." },
  { key: "contactLocation", header: "Contact Location", section: "Contact", entity: "contact", type: "text", description: "Contact location or timezone." },
  { key: "contactSource", header: "Contact Source", section: "Contact", entity: "contact", type: "text", description: "Where the contact data came from." },
  { key: "bestContactChannel", header: "Best Contact Channel", section: "Contact", entity: "contact", type: "enum", values: ["email", "phone", "linkedin", "form"], description: "Preferred contact channel." },
  { key: "contactLabels", header: "Contact Labels", section: "Contact", entity: "routing", type: "list", description: "Semicolon-separated existing contact labels." },

  { key: "channel", header: "Channel", section: "Lead/Prospect Settings", entity: "lead", type: "enum", values: channelValues, description: "Intended prospecting channel." },
  { key: "campaign", header: "Campaign", section: "Lead/Prospect Settings", entity: "routing", type: "text", description: "Existing campaign name or ID." },
  { key: "profile", header: "Outreach Profile", section: "Lead/Prospect Settings", entity: "routing", type: "text", description: "Existing outreach profile name or ID." },
  { key: "stage", header: "Stage", section: "Lead/Prospect Settings", entity: "lead", type: "enum", values: stageValues, description: "Pipeline stage." },
  { key: "temperature", header: "Temperature", section: "Lead/Prospect Settings", entity: "lead", type: "enum", values: temperatureValues, description: "Cold, warm, or hot." },
  { key: "priority", header: "Priority", section: "Lead/Prospect Settings", entity: "lead", type: "enum", values: priorityValues, description: "Lead priority." },
  { key: "ownerEmail", header: "Owner Email", section: "Lead/Prospect Settings", entity: "routing", type: "email", description: "Workspace owner email; blank uses uploader." },
  { key: "createdByEmail", header: "Created By Email", section: "Lead/Prospect Settings", entity: "routing", type: "email", description: "Workspace creator email; blank uses uploader." },
  { key: "sourcedByEmail", header: "Sourced By Email", section: "Lead/Prospect Settings", entity: "routing", type: "email", description: "Workspace sourcing user email; blank uses uploader." },
  { key: "prospectOwnerEmail", header: "Prospect Owner Email", section: "Lead/Prospect Settings", entity: "routing", type: "email", description: "Prospect owner email; blank uses uploader." },
  { key: "prospectVisibility", header: "Prospect Visibility", section: "Lead/Prospect Settings", entity: "lead", type: "enum", values: ["open"], description: "Imported prospects begin open." },

  { key: "triggerEvent", header: "Trigger Event", section: "Research", entity: "lead", type: "text", description: "Reason this prospect may need outreach now." },
  { key: "painPoints", header: "Pain Points", section: "Research", entity: "lead", type: "text", description: "Likely customer pain points." },
  { key: "businessFocus", header: "Business Focus", section: "Research", entity: "lead", type: "text", description: "Current company focus." },
  { key: "hiringSignals", header: "Hiring Signals", section: "Research", entity: "lead", type: "text", description: "Relevant hiring signals." },
  { key: "recentNews", header: "Recent News", section: "Research", entity: "lead", type: "text", description: "Relevant recent news." },
  { key: "psLine", header: "PS Line", section: "Research", entity: "lead", type: "text", description: "Personalized postscript line." },
  { key: "toolsUsed", header: "Tools Used", section: "Research", entity: "lead", type: "list", description: "Semicolon-separated tools." },
  { key: "caseStudy", header: "Case Study", section: "Research", entity: "routing", type: "text", description: "Existing case study ID; unknown values are ignored." },

  { key: "pushToInstantly", header: "Push To Instantly", section: "Routing", entity: "lead", type: "enum", values: pushValues, description: "Instantly routing status." },
  { key: "pushToLinkedIn", header: "Push To LinkedIn", section: "Routing", entity: "lead", type: "enum", values: pushValues, description: "LinkedIn routing status." },
  { key: "doNotContact", header: "Do Not Contact", section: "Routing", entity: "lead", type: "boolean", description: "True blocks outreach." },

  { key: "bantBudget", header: "BANT Budget", section: "Qualification", entity: "lead", type: "integer", description: "Budget score from 1 to 5." },
  { key: "bantAuthority", header: "BANT Authority", section: "Qualification", entity: "lead", type: "integer", description: "Authority score from 1 to 5." },
  { key: "bantNeed", header: "BANT Need", section: "Qualification", entity: "lead", type: "integer", description: "Need score from 1 to 5." },
  { key: "bantTimeline", header: "BANT Timeline", section: "Qualification", entity: "lead", type: "integer", description: "Timeline score from 1 to 5." },
  { key: "estimatedValue", header: "Estimated Value", section: "Qualification", entity: "lead", type: "number", description: "Non-negative estimated value." },
  { key: "expectedCloseDate", header: "Expected Close Date", section: "Qualification", entity: "lead", type: "date", description: "Date in YYYY-MM-DD format." },

  { key: "firstContactAt", header: "First Contact Date", section: "Activity", entity: "lead", type: "date", description: "Date in YYYY-MM-DD format." },
  { key: "lastActivityAt", header: "Last Activity Date", section: "Activity", entity: "lead", type: "date", description: "Date in YYYY-MM-DD format." },
  { key: "responseTimeMinutes", header: "Response Time Minutes", section: "Activity", entity: "lead", type: "number", description: "Non-negative response time." },
  { key: "touches", header: "Touches", section: "Activity", entity: "lead", type: "integer", description: "Non-negative touch count." },
  { key: "isIdle", header: "Is Idle", section: "Activity", entity: "lead", type: "boolean", description: "True or false." },
  { key: "idleDays", header: "Idle Days", section: "Activity", entity: "lead", type: "integer", description: "Non-negative idle-day count." },

  { key: "notes", header: "Notes", section: "Additional Information", entity: "lead", type: "text", description: "Internal prospect notes." },
  { key: "nextAction", header: "Next Action", section: "Additional Information", entity: "lead", type: "text", description: "Recommended next action." },
  { key: "leadLabels", header: "Lead Labels", section: "Additional Information", entity: "routing", type: "list", description: "Semicolon-separated existing lead labels." },
  { key: "extensions", header: "Extensions JSON", section: "Additional Information", entity: "lead", type: "json", description: "JSON object for approved channel-specific metadata." },
] as const satisfies readonly ProspectImportField[];

export type ProspectImportFieldKey = (typeof PROSPECT_IMPORT_FIELD_DEFINITIONS)[number]["key"];
export const PROSPECT_IMPORT_FIELDS: readonly ProspectImportField[] =
  PROSPECT_IMPORT_FIELD_DEFINITIONS;
export type NormalizedProspectImportRow = Partial<Record<ProspectImportFieldKey, unknown>>;

export const PROSPECT_IMPORT_HEADERS = PROSPECT_IMPORT_FIELDS.map((field) => field.header);

export function assertProspectImportRegistry(): void {
  if (PROSPECT_IMPORT_FIELDS.length !== 74) {
    throw new Error(`Prospect import registry must contain 74 fields; found ${PROSPECT_IMPORT_FIELDS.length}.`);
  }
  const headers = new Set(PROSPECT_IMPORT_HEADERS);
  if (headers.size !== PROSPECT_IMPORT_HEADERS.length) {
    throw new Error("Prospect import registry contains duplicate headers.");
  }
}

assertProspectImportRegistry();
