/** Column header labels for the leads table (shared with outreach merge variables). */
export const LEAD_TABLE_COLUMN_LABELS = {
  contact: "Contact",
  company: "Company",
  /** Prospects table: business name (maps to `companyName` / Instantly `business_name`). */
  businessName: "Business Name",
  industry: "Industry",
  intakeKind: "Intake",
  labelIds: "Labels",
  channel: "Channel",
  profileId: "Profile",
  stage: "Stage",
  owner: "Owner",
  addedBy: "Added by",
  temperature: "Temp",
  quality: "Quality",
  priority: "Priority",
  push: "Push",
  campaign: "Campaign",
  value: "Value",
  created: "Added date",
  idle: "Idle",
  updated: "Last activity",
} as const;

export type LeadTableColumnId = keyof typeof LEAD_TABLE_COLUMN_LABELS;
