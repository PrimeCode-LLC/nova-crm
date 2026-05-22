export type InstantlyCampaignStatus = number | string;

export interface InstantlySequenceVariant {
  subject: string;
  body: string;
}

export interface InstantlySequenceStep {
  type: "email";
  delay?: number;
  variants: InstantlySequenceVariant[];
}

export interface InstantlySequence {
  steps: InstantlySequenceStep[];
}

export interface InstantlyScheduleTiming {
  from: string;
  to: string;
}

export interface InstantlyScheduleEntry {
  days?: number[];
  timing?: InstantlyScheduleTiming;
  timezone?: string;
}

export interface InstantlyCampaignSchedule {
  schedules: InstantlyScheduleEntry[];
  start_date?: string;
  end_date?: string;
}

export interface InstantlyCampaign {
  id: string;
  name: string;
  status?: InstantlyCampaignStatus;
  email_list?: string[];
  campaign_schedule?: InstantlyCampaignSchedule;
  sequences?: InstantlySequence[];
  /** Analytics fields (shape varies by API version). */
  emails_sent_count?: number;
  open_count?: number;
  reply_count?: number;
  link_click_count?: number;
  bounced_count?: number;
}

export interface InstantlyCampaignListResponse {
  items?: InstantlyCampaign[];
  data?: InstantlyCampaign[];
  campaigns?: InstantlyCampaign[];
  next_cursor?: string;
  next_starting_after?: string;
  cursor?: string;
}

export interface InstantlyAccount {
  email: string;
  first_name?: string;
  last_name?: string;
  status?: number | string;
  warmup_status?: number | string;
}

export interface InstantlyAccountListResponse {
  items?: InstantlyAccount[];
  data?: InstantlyAccount[];
  accounts?: InstantlyAccount[];
}

export interface InstantlyLeadInput {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  custom_variables?: Record<string, string>;
}

export interface InstantlyBulkAddLeadsResponse {
  created_leads?: { id: string; email: string }[];
  leads_created?: number;
  leads_skipped?: number;
  status?: string;
}

export interface CreateInstantlyCampaignInput {
  name: string;
  campaign_schedule: InstantlyCampaignSchedule;
  sequences: InstantlySequence[];
  email_list?: string[];
}
