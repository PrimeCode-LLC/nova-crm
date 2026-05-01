// Domain types — the single source of truth for the CRM entities.
// These mirror the Firestore collection shapes (see PLAN.md §3).

export type ISODate = string;

export type Role =
  | "director"
  | "manager"
  | "team_lead"
  | "salesperson"
  | "data_scraper";

export type ChannelKey =
  | "cold_email"
  | "linkedin_outbound"
  | "linkedin_1to1"
  | "personalized_email"
  | "website_form"
  | "upwork"
  | "job_apply";

export type PipelineStage =
  | "new"
  | "contacted"
  | "replied"
  | "qualified"
  | "discovery"
  | "proposal"
  | "negotiation"
  | "won"
  | "lost";

export type LeadTemperature = "cold" | "warm" | "hot";
export type LeadPriority = "low" | "medium" | "high" | "urgent";
export type PushStatus = "not_ready" | "ready" | "pushed" | "do_not_push";

export type RevenueRange =
  | "lt_1m"
  | "1m_10m"
  | "10m_50m"
  | "50m_100m"
  | "100m_500m"
  | "500m_1b"
  | "gt_1b"
  | "unknown";

export type CompanySize =
  | "1-10"
  | "11-50"
  | "51-200"
  | "201-500"
  | "501-1000"
  | "1001-5000"
  | "5001+";

export interface User {
  id: string;
  email: string;
  displayName: string;
  photoURL?: string;
  roleId: Role;
  departmentId?: string;
  managerId?: string;
  title?: string;
  status: "active" | "inactive" | "pip";
  createdAt: ISODate;
}

export interface Department {
  id: string;
  name: string;
  parentId?: string;
  leadUserId?: string;
  description?: string;
}

export interface PermissionOverride {
  id: string;
  userId: string;
  resource: "leads" | "deals" | "accounts" | "contacts" | "activities";
  action: "read" | "write" | "delete";
  scope: "own" | "team" | "department" | "all" | "custom";
  effect: "grant" | "deny";
  note?: string;
  createdBy: string;
  createdAt: ISODate;
}

export interface Account {
  id: string;
  name: string;
  domain?: string;
  industry?: string;
  size?: CompanySize;
  revenueRange?: RevenueRange;
  location?: string;
  yearFounded?: number;
  website?: string;
  linkedin?: string;
  techStack?: string[];
  contactCount: number;
  leadCount: number;
  openDealValue: number;
  ownerId: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface Contact {
  id: string;
  accountId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email?: string;
  emailVerified?: boolean;
  phone?: string;
  linkedin?: string;
  title?: string;
  seniority?: string;
  location?: string;
  ownerId: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface Profile {
  id: string;
  name: string;
  channel: ChannelKey;
  type: "upwork" | "cv" | "email" | "linkedin";
  ownerId: string;
  active: boolean;
  notes?: string;
}

export interface Campaign {
  id: string;
  name: string;
  channel: ChannelKey;
  status: "draft" | "active" | "paused" | "done";
  externalRef?: string;
  startedAt?: ISODate;
  stats: {
    sent: number;
    replied: number;
    meetings: number;
    closed: number;
  };
}

export interface BANT {
  budget: number; // 1-5
  authority: number;
  need: number;
  timeline: number;
}

export interface Lead {
  id: string;
  accountId: string;
  contactId: string;
  channel: ChannelKey;
  campaignId?: string;
  profileId?: string;
  stage: PipelineStage;
  temperature: LeadTemperature;
  priority: LeadPriority;
  ownerId: string;
  scraperId?: string;

  // Snapshot of contact & account for table rendering
  contactName: string;
  contactTitle?: string;
  contactEmail?: string;
  contactLinkedIn?: string;
  companyName: string;
  companyDomain?: string;
  companyIndustry?: string;
  companySize?: CompanySize;
  revenueRange?: RevenueRange;

  // Research & personalization
  triggerEvent?: string;
  painPoints?: string;
  businessFocus?: string;
  hiringSignals?: string;
  recentNews?: string;
  psLine?: string;
  toolsUsed?: string[];
  caseStudyId?: string;

  // Campaign routing
  pushToInstantly?: PushStatus;
  pushToLinkedIn?: PushStatus;
  doNotContact?: boolean;

  // Pipeline / qualification
  bant?: BANT;
  estimatedValue?: number;
  expectedCloseDate?: ISODate;

  // Activity metrics
  firstContactAt?: ISODate;
  lastActivityAt?: ISODate;
  responseTimeMinutes?: number;
  touches: number;
  isIdle: boolean;
  idleDays?: number;

  // Free-form
  notes?: string;
  nextAction?: string;

  // Channel-specific extensions (sparse)
  extensions?: Record<string, unknown>;

  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface Touchpoint {
  id: string;
  leadId: string;
  channel: ChannelKey;
  state: string; // channel-specific, e.g., "email_step_3", "linkedin_connection_sent"
  stepNumber?: number;
  occurredAt: ISODate;
  actorId?: string;
  summary?: string;
  payload?: Record<string, unknown>;
}

export interface Deal {
  id: string;
  leadId: string;
  accountId: string;
  contactId: string;
  name: string;
  stage: PipelineStage;
  value: number;
  currency: string;
  probability: number;
  expectedCloseDate: ISODate;
  ownerId: string;
  products?: string[];
  notes?: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  wonAt?: ISODate;
  lostAt?: ISODate;
  lostReason?: string;
}

export interface ActivityCounterRow {
  id: string;
  userId: string;
  channel: ChannelKey;
  profileId?: string;
  campaignId?: string;
  date: ISODate;
  counters: Record<string, number>;
}

export interface ActivityRecord {
  id: string;
  userId: string;
  channel: ChannelKey;
  profileId?: string;
  leadId?: string;
  type: string;
  occurredAt: ISODate;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface Followup {
  id: string;
  leadId?: string;
  dealId?: string;
  contactId?: string;
  title: string;
  description?: string;
  dueAt: ISODate;
  completedAt?: ISODate;
  ownerId: string;
  priority: LeadPriority;
  auto: boolean;
}

export interface Note {
  id: string;
  leadId?: string;
  contactId?: string;
  accountId?: string;
  dealId?: string;
  authorId: string;
  body: string;
  createdAt: ISODate;
  pinned?: boolean;
}

export type TimelineEventType =
  | "lead_created"
  | "stage_changed"
  | "touchpoint_added"
  | "email_sent"
  | "email_replied"
  | "note_added"
  | "followup_created"
  | "followup_completed"
  | "deal_created"
  | "assignment_changed"
  | "field_changed";

export interface TimelineEvent {
  id: string;
  leadId: string;
  type: TimelineEventType;
  actorId?: string;
  summary: string;
  payload?: Record<string, unknown>;
  createdAt: ISODate;
}
