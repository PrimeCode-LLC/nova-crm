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
  name?: string;
  days?: number[] | Record<string, boolean>;
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
  /** Sending & tracking options (Instantly PATCH fields). */
  stop_on_reply?: boolean | null;
  stop_on_auto_reply?: boolean | null;
  stop_for_company?: boolean | null;
  open_tracking?: boolean | null;
  link_tracking?: boolean | null;
  text_only?: boolean | null;
  first_email_text_only?: boolean | null;
  daily_limit?: number | null;
  daily_max_leads?: number | null;
  email_gap?: number | null;
  random_wait_max?: number | null;
  prioritize_new_leads?: boolean | null;
  insert_unsubscribe_header?: boolean | null;
  match_lead_esp?: boolean | null;
  allow_risky_contacts?: boolean | null;
  disable_bounce_protect?: boolean | null;
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

/** Lead row from Instantly `POST /leads/list`. */
export interface InstantlyLead {
  id: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  job_title?: string | null;
  company_domain?: string | null;
  website?: string | null;
  campaign?: string | null;
  payload?: Record<string, string | number | boolean | null> | null;
}

export interface InstantlyCampaignAnalytics {
  campaign_id: string;
  campaign_name: string;
  campaign_status?: number;
  leads_count?: number;
  contacted_count?: number;
  emails_sent_count?: number;
  new_leads_contacted_count?: number;
  open_count?: number;
  open_count_unique?: number;
  reply_count?: number;
  reply_count_unique?: number;
  reply_count_unique_by_step?: number;
  open_count_unique_by_step?: number;
  link_click_count?: number;
  bounced_count?: number;
  unsubscribed_count?: number;
  completed_count?: number;
  total_opportunities?: number;
  total_opportunity_value?: number;
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
  sequences?: InstantlySequence[];
  email_list?: string[];
}
