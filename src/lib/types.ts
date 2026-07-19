// Domain types: single source of truth for the CRM entities.
// These mirror the Firestore collection shapes (see PLAN.md §3).

import type { AdminFeatureKey } from "@/lib/admin-features";
import type { OpportunitySourceType } from "@/lib/ai/opportunity-fit-types";

export type ISODate = string;

export type Role =
  | "director"
  | "manager"
  | "team_lead"
  | "salesperson"
  /** @deprecated Prefer `prospecting`; kept for existing Firestore `roleId` values. */
  | "data_scraper"
  | "prospecting";

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
  | "viewed"
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
  | "solo"
  | "1-10"
  | "11-50"
  | "51-200"
  | "201-500"
  | "501-1000"
  | "1001-5000"
  | "5001+";

/** Top-of-funnel rows from research/scraping before sales treats them as pipeline leads. */
export type LeadIntakeKind = "prospect" | "sales_lead";

/** Who may see a prospect before/after channel assignments. */
export type ProspectVisibility = "open" | "assigned";

/** Channel + responsible user on a prospect (owner assigns; assignee pushes to shared Lead). */
export interface ProspectChannelAssignment {
  id: string;
  channel: ChannelKey;
  assigneeId: string;
  assignedAt: ISODate;
  assignedById: string;
  pushedAt?: ISODate;
  pushedByUserId?: string;
}

export type BusinessStatus = "active" | "new" | "dormant";

export type WebsiteStatus = "live" | "under_construction" | "none";

export type OnlineActivityScore = "low" | "medium" | "high";

export type EmailVerificationStatus = "not_verified" | "verified" | "bounced" | "catch_all";

export type BestContactChannel = "email" | "phone" | "linkedin" | "form";

export interface User {
  id: string;
  email: string;
  displayName: string;
  photoURL?: string;
  roleId: Role;
  departmentId?: string;
  managerId?: string;
  /** Denormalized chain of manager user ids (for Firestore read rules). Maintained on hierarchy edits. */
  managerAncestorIds?: string[];
  title?: string;
  /** Workspace-level super admin (can manage users alongside director / founder). */
  isSuperAdmin?: boolean;
  /** Display name from signup (customer company), not the SaaS tenant id. */
  company?: string;
  /** SaaS organization (tenant). All CRM rows must filter by this. */
  organizationId?: string;
  /** Set while self-service join is awaiting admin approval (no tenant access yet). */
  membershipPendingOrgId?: string;
  /** Cached for fast reads in the app shell; authoritative copy lives in the org member doc. */
  orgRole?: OrgMemberRole;
  status: "active" | "inactive" | "pip";
  createdAt: ISODate;
  /** Personal AI preferences (tone, extra instructions). */
  aiPreferences?: {
    tone?: "professional" | "friendly" | "concise";
    extraInstructions?: string;
    saveAnalysisToTimeline?: boolean;
  };
  /**
   * Extra admin capabilities without raising `roleId`.
   * Managed by directors / org admins via server API only.
   */
  featureGrants?: AdminFeatureKey[];
}

/** SaaS customer (tenant). Managed via platform admin + Admin SDK + tenant owner. */
export type OrganizationStatus = "trial" | "active" | "suspended";

export type SaaSPlanId = "free" | "pro" | "enterprise";

export interface OrganizationSettings {
  billingEmail?: string;
  /** Internal notes for operators (not shown to tenant users). */
  operatorNotes?: string;
  /** Per-tenant secret for `POST /api/integrations/webhook/lead` (never returned to browsers). */
  inboundWebhookSecret?: string;
  /** Per-tenant secret for `POST /api/integrations/webhook/instantly?organizationId=…` (never returned to browsers). */
  instantlyWebhookSecret?: string;
}

/** Workspace-wide channel admin config; stored on org doc as `channelAdmin`. */
export type OrganizationCustomChannelRow = {
  id: string;
  name: string;
  description: string;
  stages: { key: string; label: string }[];
  auto: boolean;
  /** When false, channel is hidden from pickers/widgets (existing data still shows). */
  enabled: boolean;
};

export type OrganizationChannelAdminConfig = {
  autoMap: Record<ChannelKey, boolean>;
  /** Soft-disable: false hides channel from pickers/widgets org-wide. */
  enabledMap: Record<ChannelKey, boolean>;
  descriptionOverrides: Partial<Record<ChannelKey, string>>;
  customChannels: OrganizationCustomChannelRow[];
};

/** Org-wide default keyword filters for the intake pool (managed by admins). */
export type OrganizationIntakeFilterDefaults = {
  includeKeywords: string[];
  excludeKeywords: string[];
};

/** Re-export Intent Playbook types for consumers that import from `@/lib/types`. */
export type {
  IntentPlaybook,
  IntentPlaybookTemplateId,
  IntentSignalDefinition,
  IntentSignalCategory,
  QualityMatchedSignal,
  QualityScoreResult,
} from "@/lib/intent/types";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  planId: SaaSPlanId;
  /** Seat cap (per plan or operator override). `null` / undefined = unlimited. */
  maxUsers?: number;
  /** Live count of active members; refreshed on add/remove. */
  seatsUsed?: number;
  /** Owner is the only member that cannot be removed; required after first signup. */
  ownerUid?: string;
  /** Primary contact email (typically owner's signup email). */
  primaryEmail?: string;
  /** Set when the platform admin pre-seats an owner before they have signed up yet. */
  pendingOwnerEmail?: string;
  /** ISO date when the trial ends (used to gate feature/seat warnings). */
  trialEndsAt?: ISODate;
  settings: OrganizationSettings;
  /** From Firestore `channelAdmin`; stripped in `sanitizeOrganizationForApi`. */
  channelAdmin?: OrganizationChannelAdminConfig;
  /** Team-wide intake pool keyword defaults; readable by all members. */
  intakeFilterDefaults?: OrganizationIntakeFilterDefaults;
  /**
   * Workspace Intent Playbook — drives prospect/lead Quality Score.
   * Stored on the org doc; parsed via `parseIntentPlaybook`.
   */
  intentPlaybook?: import("@/lib/intent/types").IntentPlaybook;
  createdAt: ISODate;
  updatedAt: ISODate;
  /** Populated by platform GET APIs after stripping `settings.inboundWebhookSecret`. */
  hasInboundWebhookSecret?: boolean;
  /**
   * SHA-256 of the secret segment of the org-wide self-service join link.
   * Never exposed to clients; admins receive the full URL only when creating or rotating the link.
   */
  openJoinTokenHash?: string;
}

/** Authoritative role for a user inside a single organization. */
export type OrgMemberRole = "owner" | "admin" | "manager" | "member";

export type OrgMemberStatus = "active" | "invited" | "disabled" | "pending";

export type ScriptCategory =
  | "pitch"
  | "rebuttal"
  | "email_template"
  | "call_script"
  | "meeting_agenda"
  | "followup_template"
  | "other";

export interface ScriptLibraryItem {
  id: string;
  organizationId: string;
  ownerUid: string;
  ownerName?: string;
  title: string;
  category: ScriptCategory;
  primaryText: string;
  secondaryText?: string;
  content: string;
  tags: string[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface OrganizationMember {
  /** Same as the auth uid. Doc id = uid. */
  uid: string;
  organizationId: string;
  email: string;
  displayName: string;
  role: OrgMemberRole;
  status: OrgMemberStatus;
  /** Who invited them (or "owner-bootstrap" for the first owner). */
  invitedByUid: string;
  joinedAt: ISODate;
  /** When the owner / admin disabled this member; null while active. */
  disabledAt?: ISODate;
}

/** Pending invitation. Token is hashed; only the recipient knows the plaintext. */
export type OrganizationInviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface OrganizationInvite {
  id: string;
  organizationId: string;
  email: string;
  role: OrgMemberRole;
  /** SHA-256 of the secret token sent to the recipient. */
  tokenHash: string;
  status: OrganizationInviteStatus;
  expiresAt: ISODate;
  createdAt: ISODate;
  createdByUid: string;
  acceptedAt?: ISODate;
  acceptedByUid?: string;
}

/** Product operator (you / staff). Not the same as workspace `isSuperAdmin`. */
export type PlatformAdminRole = "owner" | "admin";

export interface PlatformAdminRecord {
  uid: string;
  email: string;
  role: PlatformAdminRole;
  active: boolean;
  createdByUid?: string;
  createdAt: ISODate;
}

/** Workspace-defined tag for leads, deals, companies, and contacts. */
export interface CrmLabel {
  id: string;
  organizationId: string;
  name: string;
  /** CSS color (e.g. hsl(...) or #rgb). */
  color?: string;
  createdAt: ISODate;
  updatedAt: ISODate;
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
  /** When `scope` is `department`, which workspace department this rule refers to (audit trail; row rules still org-wide until enforced). */
  scopeDepartmentId?: string;
  /** When `scope` is `custom`, documents the intended boundary for admins and future policy work. */
  scopeCustomDefinition?: string;
  /** When `scope` is `team`, optionally anchor the subtree to a manager (that person + their reports). Omit for “this user’s team” default. */
  scopeTeamAnchorUserId?: string;
  note?: string;
  createdBy: string;
  createdAt: ISODate;
}

export interface Account {
  id: string;
  name: string;
  domain?: string;
  industry?: string;
  /** One-line positioning / description for outreach. */
  businessDescription?: string;
  size?: CompanySize;
  revenueRange?: RevenueRange;
  location?: string;
  city?: string;
  state?: string;
  country?: string;
  yearFounded?: number;
  businessStatus?: BusinessStatus;
  website?: string;
  websiteStatus?: WebsiteStatus;
  linkedin?: string;
  techStack?: string[];
  onlineActivityScore?: OnlineActivityScore;
  /** ISO date of last notable site change, if known. */
  lastWebsiteActivityAt?: ISODate;
  /** Free-text observation when date is unknown. */
  lastWebsiteActivityNote?: string;
  careersPageUrl?: string;
  contactCount: number;
  leadCount: number;
  openDealValue: number;
  ownerId: string;
  /** Assigned workspace labels (`labels` collection ids). */
  labelIds?: string[];
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
  personalEmail?: string;
  emailVerified?: boolean;
  emailVerificationStatus?: EmailVerificationStatus;
  phone?: string;
  linkedin?: string;
  title?: string;
  seniority?: string;
  location?: string;
  /** e.g. Website, LinkedIn, Google Maps, Crunchbase */
  contactSource?: string;
  bestContactChannel?: BestContactChannel;
  ownerId: string;
  labelIds?: string[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface Profile {
  id: string;
  name: string;
  channel: ChannelKey;
  ownerId: string;
  active: boolean;
  notes?: string;
  /** Short stack label for Fit Check (e.g. "MERN", ".NET"). */
  stackLabel?: string;
  /** Fit Check opportunity types this persona appears under (overrides channel defaults). */
  fitCheckCategories?: OpportunitySourceType[];
  /** Knowledge libraries for this persona (many profiles can share one library). */
  knowledgeLibraryIds?: string[];
  /** Specific documents to use (e.g. one MERN playbook in a category library). */
  knowledgeDocumentIds?: string[];
}

export interface Campaign {
  id: string;
  name: string;
  channel: ChannelKey;
  status: "draft" | "active" | "paused" | "done";
  externalRef?: string;
  /** Instantly campaign UUID (mirrors externalRef without prefix). */
  instantlyId?: string;
  startedAt?: ISODate;
  lastSyncedAt?: ISODate;
  sequenceSummary?: { steps: number };
  stats: {
    sent: number;
    replied: number;
    meetings: number;
    closed: number;
    opened?: number;
    bounced?: number;
    linkClicks?: number;
    unsubscribed?: number;
    leadsCount?: number;
    contacted?: number;
    completed?: number;
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
  /** Sales owner; empty string = open queue (visible to whole org until someone claims). */
  ownerId: string;
  /** Firebase uid of the user who created this lead (audit / performance reviews). */
  createdById?: string;
  /** User who sourced / entered the row (prospecting team). */
  scraperId?: string;
  /**
   * `prospect` = intake only (lists, campaigns, integrations); becomes a tracked sales row when promoted.
   * Omitted or `sales_lead` = normal pipeline lead.
   */
  intakeKind?: LeadIntakeKind;

  /** Prospect creator / channel manager; set when `intakeKind === "prospect"`. */
  prospectOwnerId?: string;
  /**
   * Channel workflow state only (not list visibility).
   * `open` = no channel assignees yet; `assigned` = channels have been assigned.
   * Read access follows the same owner/team/dept hierarchy as sales leads.
   */
  prospectVisibility?: ProspectVisibility;
  prospectChannelAssignments?: ProspectChannelAssignment[];
  /** Denormalized assignee user ids for Firestore queries. */
  prospectAssigneeIds?: string[];
  /** Shared sales Lead id after first channel push. */
  linkedSalesLeadId?: string;

  /** Back-link to prospect row when this Lead was created via channel push. */
  prospectSourceId?: string;
  /** Accumulated channel tags from assignee pushes. */
  channelTags?: ChannelKey[];
  /** Users who pushed their assigned channel into this shared Lead. */
  sharedOwnerIds?: string[];

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
  /** Instantly lead id after push to a campaign. */
  instantlyLeadId?: string;
  pushToLinkedIn?: PushStatus;
  doNotContact?: boolean;

  // Pipeline / qualification
  bant?: BANT;
  estimatedValue?: number;
  expectedCloseDate?: ISODate;

  /**
   * Intent Quality Score (0–100) from the org Intent Playbook.
   * Also recomputed live in the UI when the playbook changes.
   */
  qualityScore?: number;
  /** Count of matched intent signals (excludes engagement boosts). */
  qualitySignalCount?: number;
  /** Matched signal ids from last score run. */
  qualityMatchedSignalIds?: string[];
  qualityScoredAt?: ISODate;
  /** Highest-scoring service lane for outreach angle (from Intent Playbook routes). */
  primaryOpportunityId?: string;
  primaryOpportunityLabel?: string;
  /** When true, auto-temperature from Quality Score will not overwrite `temperature`. */
  temperatureLocked?: boolean;

  /** Prospecting strategy that guided research (attribution). */
  strategyId?: string;
  /** Buyer persona targeted when the prospect was created. */
  personaId?: string;
  /** Strategy version at attribution time. */
  strategyVersion?: number;
  /** Strategy assignment that produced this prospect. */
  strategyAssignmentId?: string;

  // Activity metrics
  firstContactAt?: ISODate;
  lastActivityAt?: ISODate;
  responseTimeMinutes?: number;
  touches: number;
  isIdle: boolean;
  idleDays?: number;

  /** Latest inbound reply detected (IMAP / Instantly). */
  lastReplyAt?: ISODate;
  lastReplyMessageId?: string;
  lastReplySource?: "imap" | "instantly" | "manual";
  /**
   * Soft prompt after a reply: promote prospect → sales lead and/or move stage to `replied`.
   * Set to `pending` on reply; cleared via accept (`accepted`) or dismiss (`dismissed`).
   */
  replyReviewStatus?: "pending" | "dismissed" | "accepted";

  // Free-form
  notes?: string;
  nextAction?: string;

  // Channel-specific extensions (sparse)
  extensions?: Record<string, unknown>;

  labelIds?: string[];

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
  labelIds?: string[];
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

/** Channel for outbound copy; `other` resolves to the lead's channel on create. */
export type FollowupChannel = ChannelKey | "other";

export type FollowupPlanStatus = "active" | "paused" | "superseded" | "completed";

/**
 * How an AI sequence was scoped:
 * - `full` — first touch through last email
 * - `continue` — intro already sent; draft remaining touches only
 */
export type FollowupSequenceMode = "full" | "continue";
export type FollowupDeliveryStatus = "scheduled" | "sent" | "failed" | "cancelled";

/** AI-generated cadence for a lead; open follow-ups reference `planId`. */
export interface FollowupPlan {
  id: string;
  leadId: string;
  ownerId: string;
  status: FollowupPlanStatus;
  planSummary: string;
  createdAt: ISODate;
  /** Multi-step cadence (vs one-off reminders). */
  kind?: "sequence";
  sequenceMode?: FollowupSequenceMode;
  pausedAt?: ISODate;
  /** Human-readable reason (e.g. lead replied by email). */
  pausedReason?: string;
  /** `${mailboxId}:in:${uid}` when paused due to inbox reply. */
  replyMessageId?: string;
  supersededByPlanId?: string;
  /** Set when every step in the sequence has been completed or sent. */
  completedAt?: ISODate;
}

export interface Followup {
  id: string;
  leadId?: string;
  dealId?: string;
  contactId?: string;
  title: string;
  description?: string;
  /** Ready-to-send message (Upwork, LinkedIn, email, etc.). */
  messageBody?: string;
  /** Subject line when this step is queued/sent as email. */
  emailSubject?: string;
  channel?: FollowupChannel;
  /** Groups followups created together from one AI suggestion run. */
  planId?: string;
  aiGenerated?: boolean;
  /** Set when the parent plan is paused (step skipped until regen or resume). */
  pausedAt?: ISODate;
  dueAt: ISODate;
  completedAt?: ISODate;
  ownerId: string;
  priority: LeadPriority;
  auto: boolean;
  /** Queued outbound email id (`scheduledEmails` doc) while pending send. */
  scheduledEmailId?: string;
  /** When the linked scheduled email is set to send. */
  emailScheduledAt?: ISODate;
  /** Durable outbound state retained after the scheduled-email link is cleared. */
  deliveryStatus?: FollowupDeliveryStatus;
  sentAt?: ISODate;
  /** RFC 5322 Message-ID of the outbound email (no angle brackets), for sequence threading. */
  sentMessageId?: string;
  failedAt?: ISODate;
  cancelledAt?: ISODate;
  deliveryError?: string;
  cancelReason?: string;
}

/** Assigned work between teammates (review, email, etc.). Optional lead context + visibility. */
export type LeadTaskType = "review" | "email" | "call" | "document" | "other";

/**
 * Controls how the task is **linked** in the UI, not who can read it: visibility is always limited to
 * assignee, requester, and oversight roles (org owner/admin, CRM director, super-admin).
 *
 * `on_lead` — tied to the lead (Tasks tab, context); `assignees_only` — handoff-style link with the same privacy.
 */
export type LeadTaskVisibility = "on_lead" | "assignees_only";

export interface LeadTask {
  id: string;
  leadId?: string;
  title: string;
  description?: string;
  taskType: LeadTaskType;
  visibility: LeadTaskVisibility;
  assigneeId: string;
  createdById: string;
  dueAt?: ISODate;
  completedAt?: ISODate;
  createdAt: ISODate;
  /** Denormalized when `leadId` is set so assignees still see company/contact without lead ACL. */
  contextCompany?: string;
  contextContact?: string;
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
  | "followup_plan_paused"
  | "lead_task_created"
  | "lead_task_completed"
  | "deal_created"
  | "assignment_changed"
  | "field_changed"
  | "ai_analysis"
  | "meeting_scheduled"
  | "meeting_completed"
  | "meeting_cancelled"
  | "prospect_channel_pushed";

/** Scheduling / calendar module */
export type MeetingLocationType =
  | "google_meet"
  | "zoom"
  | "teams"
  | "phone"
  | "in_person"
  | "custom";

export type SchedulingLinkType = "personal" | "team" | "event";

export type CalendarDelegatePermission =
  | "view_availability"
  | "book"
  | "manage_links"
  | "cancel";

export type CalendarGranteeType = "user" | "role" | "department" | "org" | "reports";

export type MeetingStatus = "scheduled" | "completed" | "cancelled" | "no_show";

export type MeetingSource =
  | "public_link"
  | "internal"
  | "manual"
  | "invite_rsvp"
  | "email_thread"
  | "external_booking";

export interface AvailabilityTimeSlot {
  start: string;
  end: string;
}

export type WeekdayKey =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export type WeeklyAvailability = Record<WeekdayKey, AvailabilityTimeSlot[]>;

export interface AvailabilitySchedule {
  id: string;
  organizationId: string;
  ownerUid: string;
  name: string;
  isDefault: boolean;
  timezone: string;
  weekly: WeeklyAvailability;
  minNoticeHours: number;
  maxDaysAhead: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface SchedulingLink {
  id: string;
  organizationId: string;
  slug: string;
  hostId: string;
  hostName?: string;
  title: string;
  description?: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  locationType: MeetingLocationType;
  locationDetails?: string;
  linkType: SchedulingLinkType;
  color?: string;
  active: boolean;
  scheduleId?: string;
  roundRobinHostIds?: string[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface Meeting {
  id: string;
  organizationId: string;
  hostId: string;
  hostName?: string;
  /** Additional internal hosts who received a Google Calendar copy. */
  internalHostIds?: string[];
  /** Google Calendar event id per host uid. */
  googleEventIdsByHost?: Record<string, string>;
  bookedById?: string;
  bookedByName?: string;
  leadId?: string;
  leadOwnerId?: string;
  contactId?: string;
  schedulingLinkId?: string;
  title: string;
  startAt: ISODate;
  endAt: ISODate;
  timezone: string;
  status: MeetingStatus;
  attendeeName: string;
  attendeeEmail: string;
  attendeeNotes?: string;
  guestEmails?: string[];
  locationType: MeetingLocationType;
  locationDetails?: string;
  source: MeetingSource;
  /** ICS UID from an inbound calendar invite (RSVP correlation). */
  inboundInviteUid?: string;
  organizerEmail?: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface CalendarDelegation {
  id: string;
  organizationId: string;
  hostId: string;
  hostName?: string;
  granteeType: CalendarGranteeType;
  granteeIds: string[];
  permissions: CalendarDelegatePermission[];
  schedulingLinkIds?: string[];
  createdBy: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type MailboxDelegatePermission = "view" | "send";

/** One delegation doc per mailbox owner (host); grantees may read and send mail. */
export interface MailboxDelegation {
  id: string;
  organizationId: string;
  hostId: string;
  granteeUserIds: string[];
  permissions: MailboxDelegatePermission[];
  createdBy: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type CalendarProvider = "google" | "microsoft";

export interface CalendarConnection {
  id: string;
  organizationId: string;
  ownerUid: string;
  provider: CalendarProvider;
  accountEmail: string;
  /** Calendar used to check conflicts (display label). */
  checkCalendarLabel?: string;
  /** Calendar where Nova writes new meetings. */
  writeCalendarLabel?: string;
  includeBuffers: boolean;
  syncExternalChanges: boolean;
  status: "connected" | "error" | "disconnected";
  lastSyncAt?: ISODate;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** Read-only event pulled from a connected Google or Outlook calendar. */
export interface ExternalCalendarEvent {
  id: string;
  provider: CalendarProvider;
  accountEmail: string;
  title: string;
  startAt: ISODate;
  endAt: ISODate;
  allDay?: boolean;
}

export interface TimelineEvent {
  id: string;
  leadId: string;
  type: TimelineEventType;
  actorId?: string;
  summary: string;
  payload?: Record<string, unknown>;
  createdAt: ISODate;
}

/** Org-wide Slack-style chat (Firestore `workspaceChatChannels`). */
export type WorkspaceChatChannelKind = "public" | "dm";

export interface WorkspaceChatChannel {
  id: string;
  organizationId: string;
  kind: WorkspaceChatChannelKind;
  /** Lowercase handle without # for public channels (e.g. general, sales). */
  slug: string;
  /** Display label (e.g. general, random-1, or other user's name for DMs). */
  name: string;
  /** For `dm`: exactly two Firebase user ids in the org. */
  memberIds?: string[];
  createdById: string;
  createdAt: ISODate;
  updatedAt?: ISODate;
}

/** One chat line (Firestore `workspaceChatMessages`). */
export interface WorkspaceChatMessage {
  id: string;
  organizationId: string;
  channelId: string;
  authorId: string;
  body: string;
  /** Parsed from `@[uid]` tokens at send time for notifications/search. */
  mentionUserIds?: string[];
  createdAt: ISODate;
}

/** Firestore `workspaceChatReads/{organizationId}__{userId}` — per-channel last seen message time (ISO). */
export interface WorkspaceChatReadState {
  organizationId: string;
  userId: string;
  channels: Record<string, ISODate>;
}

/** RSS feed source platform (preset keys like `reddit`/`x`/`linkedin` or custom). */
export type ScraperPlatform = string;

/** Intent bucket for scraped posts (preset keys like `hiring`/`problem` or custom). */
export type ScraperCategory = string;

/** Admin-configured RSS feed (`scraperFeeds`). */
export interface ScraperFeed {
  id: string;
  organizationId: string;
  name: string;
  platform: ScraperPlatform;
  category: ScraperCategory;
  feedUrl: string;
  enabled: boolean;
  /** Minutes between scheduled runs (default 60). */
  runIntervalMinutes: number;
  lastRunAt?: ISODate;
  lastSuccessAt?: ISODate;
  lastError?: string;
  lastNewCount?: number;
  createdAt: ISODate;
  updatedAt: ISODate;
  createdByUid?: string;
}

export type ScraperRawItemStatus = "available" | "promoted" | "dismissed";

/** Staging row from RSS ingest (`scraperRawItems`); unpromoted rows expire after 7 days. */
export interface ScraperRawItem {
  id: string;
  organizationId: string;
  feedId: string;
  feedName: string;
  platform: ScraperPlatform;
  category: ScraperCategory;
  /** Stable dedupe key (`guid` or canonical link). */
  dedupeKey: string;
  guid?: string;
  link: string;
  title: string;
  content: string;
  contentSnippet?: string;
  creator?: string;
  dcCreator?: string;
  pubDate?: string;
  isoDate?: ISODate;
  publishedAt: ISODate;
  status: ScraperRawItemStatus;
  promotedToLeadId?: string;
  promotedAt?: ISODate;
  promotedByUserId?: string;
  dismissedAt?: ISODate;
  dismissedByUserId?: string;
  /** When `status === available`, deleted after this time. */
  expiresAt: ISODate;
  createdAt: ISODate;
  updatedAt: ISODate;
}
