import type {
  ChannelKey,
  PipelineStage,
  SystemRoleId,
  RevenueRange,
  CompanySize,
  LeadTemperature,
  LeadPriority,
  PushStatus,
  LeadIntakeKind,
} from "./types";

export const APP_NAME = "Nova CRM";

export const CHANNELS: Record<
  ChannelKey,
  { label: string; short: string; color: string; iconKey: string }
> = {
  cold_email: { label: "Cold Email", short: "Email", color: "chart-1", iconKey: "Mail" },
  personalized_email: { label: "1:1 Email", short: "1:1", color: "chart-2", iconKey: "MailPlus" },
  linkedin_outbound: { label: "LinkedIn Outbound", short: "LinkedIn", color: "chart-3", iconKey: "Linkedin" },
  linkedin_1to1: { label: "LinkedIn 1:1", short: "LI 1:1", color: "chart-4", iconKey: "UserPlus" },
  website_form: { label: "Website Form", short: "Form", color: "chart-5", iconKey: "Globe" },
  upwork: { label: "Upwork", short: "Upwork", color: "chart-2", iconKey: "Briefcase" },
  job_apply: { label: "Job Apply", short: "CV", color: "chart-3", iconKey: "FileText" },
};

export const CHANNEL_LIST = Object.entries(CHANNELS).map(([key, v]) => ({
  key: key as ChannelKey,
  ...v,
}));

/** Channels where the lead should record which workspace profile was used (Admin → Profiles). */
export const CHANNELS_REQUIRING_OUTREACH_PROFILE: readonly ChannelKey[] = ["upwork", "job_apply"];

export function outreachProfileFieldLabel(channel: ChannelKey): string {
  if (channel === "upwork") return "Upwork profile";
  if (channel === "job_apply") return "CV / apply profile";
  return "Outreach profile";
}

export const PIPELINE_STAGES: {
  key: PipelineStage;
  label: string;
  tone: "neutral" | "blue" | "cyan" | "green" | "red" | "amber";
  isTerminal?: boolean;
  isWon?: boolean;
}[] = [
  { key: "new", label: "New", tone: "neutral" },
  { key: "viewed", label: "Viewed", tone: "cyan" },
  { key: "contacted", label: "Contacted", tone: "blue" },
  { key: "replied", label: "Replied", tone: "cyan" },
  { key: "qualified", label: "Qualified", tone: "blue" },
  { key: "discovery", label: "Discovery", tone: "blue" },
  { key: "proposal", label: "Proposal", tone: "amber" },
  { key: "negotiation", label: "Negotiation", tone: "amber" },
  { key: "won", label: "Won", tone: "green", isTerminal: true, isWon: true },
  { key: "lost", label: "Lost", tone: "red", isTerminal: true },
];

export const STAGES_BY_KEY: Record<PipelineStage, (typeof PIPELINE_STAGES)[number]> =
  Object.fromEntries(PIPELINE_STAGES.map((s) => [s.key, s])) as Record<
    PipelineStage,
    (typeof PIPELINE_STAGES)[number]
  >;

export const KANBAN_STAGES: PipelineStage[] = [
  "new",
  "viewed",
  "contacted",
  "replied",
  "qualified",
  "discovery",
  "proposal",
  "negotiation",
  "won",
];

export const ROLES: Record<SystemRoleId, { label: string; description: string }> = {
  director: { label: "Director", description: "Sees and edits everything" },
  manager: { label: "Manager", description: "Sees their reporting tree; writes own + reporting team" },
  team_lead: { label: "Team Lead", description: "Sees team; writes own + team" },
  salesperson: { label: "Salesperson", description: "Sees + writes own leads" },
  data_scraper: {
    label: "Data scraper (legacy)",
    description: "Same as Prospecting, use Prospecting for new members",
  },
  prospecting: {
    label: "Prospecting & data",
    description: "Adds top-of-funnel prospects; sees rows they sourced or own until handoff",
  },
  content_team: {
    label: "Content team",
    description: "Content calendar, brands, and captures — no sales pipeline access",
  },
};

/** Label for a CRM role id (system preset or custom id string). */
export function roleLabel(roleId: string | undefined | null): string {
  if (!roleId) return ROLES.salesperson.label;
  if (roleId in ROLES) return ROLES[roleId as SystemRoleId].label;
  return roleId;
}

export const INTAKE_KIND_META: Record<
  LeadIntakeKind,
  { label: string; short: string; className: string }
> = {
  prospect: {
    label: "Prospect (intake)",
    short: "Prospect",
    className: "bg-muted text-muted-foreground border-border",
  },
  sales_lead: {
    label: "Sales lead",
    short: "Lead",
    className: "bg-primary/10 text-primary border-primary/20",
  },
};

export const REVENUE_RANGES: Record<RevenueRange, string> = {
  lt_1m: "< $1M",
  "1m_10m": "$1M – $10M",
  "10m_50m": "$10M – $50M",
  "50m_100m": "$50M – $100M",
  "100m_500m": "$100M – $500M",
  "500m_1b": "$500M – $1B",
  gt_1b: "> $1B",
  unknown: "Unknown",
};

export const COMPANY_SIZES: CompanySize[] = [
  "solo",
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1001-5000",
  "5001+",
];

export const COMPANY_SIZE_LABELS: Record<CompanySize, string> = {
  solo: "Solo",
  "1-10": "2–10",
  "11-50": "11–50",
  "51-200": "51–200",
  "201-500": "201–500",
  "501-1000": "501–1,000",
  "1001-5000": "1,001–5,000",
  "5001+": "5,000+",
};

export const TEMPERATURE_TONE: Record<
  LeadTemperature,
  { label: string; className: string }
> = {
  cold: { label: "Cold", className: "bg-info/10 text-info border-info/20" },
  warm: { label: "Warm", className: "bg-warning/10 text-warning border-warning/20" },
  hot: { label: "Hot", className: "bg-destructive/10 text-destructive border-destructive/20" },
};

export const PRIORITY_TONE: Record<
  LeadPriority,
  { label: string; className: string }
> = {
  low: { label: "Low", className: "bg-muted text-muted-foreground" },
  medium: { label: "Medium", className: "bg-info/10 text-info" },
  high: { label: "High", className: "bg-warning/10 text-warning" },
  urgent: { label: "Urgent", className: "bg-destructive/10 text-destructive" },
};

export const PUSH_STATUS_TONE: Record<
  PushStatus,
  { label: string; className: string }
> = {
  not_ready: { label: "Not Ready", className: "bg-muted text-muted-foreground" },
  ready: {
    label: "Ready",
    className: "bg-success/10 text-success border-success/20",
  },
  pushed: { label: "Pushed", className: "bg-info/10 text-info border-info/20" },
  do_not_push: {
    label: "Do Not Push",
    className: "bg-destructive/10 text-destructive border-destructive/20",
  },
};

export const CHANNEL_FUNNELS: Record<
  ChannelKey,
  { key: string; label: string }[]
> = {
  cold_email: [
    { key: "sent", label: "Sent" },
    { key: "opened", label: "Opened" },
    { key: "clicked", label: "Clicked" },
    { key: "replied", label: "Replied" },
    { key: "meeting", label: "Meeting" },
    { key: "closed", label: "Closed" },
  ],
  linkedin_outbound: [
    { key: "connection_sent", label: "Connection Sent" },
    { key: "accepted", label: "Accepted" },
    { key: "messaged", label: "Messaged" },
    { key: "replied", label: "Replied" },
    { key: "meeting", label: "Meeting" },
    { key: "closed", label: "Closed" },
  ],
  linkedin_1to1: [
    { key: "messaged", label: "Messaged" },
    { key: "replied", label: "Replied" },
    { key: "meeting", label: "Meeting" },
    { key: "closed", label: "Closed" },
  ],
  personalized_email: [
    { key: "sent", label: "Sent" },
    { key: "replied", label: "Replied" },
    { key: "meeting", label: "Meeting" },
    { key: "closed", label: "Closed" },
  ],
  website_form: [
    { key: "submitted", label: "Submitted" },
    { key: "contacted", label: "Contacted" },
    { key: "meeting", label: "Meeting" },
    { key: "closed", label: "Closed" },
  ],
  upwork: [
    { key: "applied", label: "Applied" },
    { key: "viewed", label: "Viewed" },
    { key: "replied", label: "Replied" },
    { key: "hired", label: "Hired" },
    { key: "revenue", label: "Revenue" },
  ],
  job_apply: [
    { key: "applied", label: "Applied" },
    { key: "recruiter_reply", label: "Recruiter Reply" },
    { key: "interview", label: "Interview" },
    { key: "offer", label: "Offer" },
  ],
};

export const IDLE_THRESHOLD_DAYS: Record<PipelineStage, number> = {
  new: 3,
  viewed: 4,
  contacted: 5,
  replied: 2,
  qualified: 5,
  discovery: 7,
  proposal: 7,
  negotiation: 5,
  won: 9999,
  lost: 9999,
};
