import { LEAD_TABLE_COLUMN_LABELS, type LeadTableColumnId } from "@/lib/leads/lead-table-labels";

export type InstantlyMergeVariable = {
  token: string;
  /** Leads table column this value comes from. */
  columnId: LeadTableColumnId;
  label: string;
  /** Which field under that column (shown as subtitle). */
  source: string;
};

function col(columnId: LeadTableColumnId, token: string, source: string): InstantlyMergeVariable {
  return {
    token,
    columnId,
    label: LEAD_TABLE_COLUMN_LABELS[columnId],
    source,
  };
}

/** Merge tags available when pushing Nova leads to Instantly (use in Sequence subject/body). */
export const INSTANTLY_MERGE_VARIABLES: InstantlyMergeVariable[] = [
  col("contact", "first_name", "Contact name (first word)"),
  col("contact", "last_name", "Contact name (remaining words)"),
  col("contact", "email", "Email address"),
  col("contact", "contact_title", "Job title"),
  col("contact", "linkedin", "LinkedIn URL"),
  col("company", "company_name", "Company name"),
  col("company", "company_domain", "Company domain"),
  col("company", "company_industry", "Industry"),
  col("intakeKind", "intake_kind", "Prospect vs sales lead"),
  col("channel", "channel", "Outreach channel"),
  col("stage", "stage", "Pipeline stage"),
  col("temperature", "temperature", "Cold / warm / hot"),
  col("priority", "priority", "Low → urgent"),
  col("value", "estimated_value", "Estimated deal value"),
  col("contact", "trigger_event", "Research — trigger event"),
  col("contact", "ps_line", "Research — P.S. line"),
  col("company", "pain_points", "Research — pain points"),
  col("company", "business_focus", "Research — business focus"),
];
