import type { Role } from "@/lib/types";

/** Layout presets an owner can pick or preview. */
export type DashboardViewMode = "auto" | "ops" | "classic" | "frontline";

export type DashboardWidgetKey =
  | "pulse"
  | "emailVolume"
  | "followupSchedule"
  | "scorecard"
  | "needsAttention"
  | "inboxPerformance"
  | "mailboxUtilization"
  | "activityFeed"
  | "actionBoard"
  | "replyReviews"
  | "aiBrief"
  | "pipelineKpis"
  | "classicKpis"
  | "trendChart"
  | "channelFunnels"
  | "pipelineDistribution"
  | "channelMix"
  | "idleLeads"
  | "campaigns"
  | "wallLink";

export type DashboardWidgets = Record<DashboardWidgetKey, boolean>;

export type DashboardPreferences = {
  viewMode: DashboardViewMode;
  /** When set (owners only), layout follows this CRM role instead of the real viewer. */
  previewRole: Role | null;
  widgets: DashboardWidgets;
};

export const DASHBOARD_VIEW_MODE_OPTIONS: {
  key: DashboardViewMode;
  label: string;
  description: string;
}[] = [
  {
    key: "auto",
    label: "Auto (my role)",
    description: "Uses your real role — ops for owners/managers, personal for frontline.",
  },
  {
    key: "ops",
    label: "Owner command board",
    description: "Pulse, outreach charts, live feed, scorecard, action board.",
  },
  {
    key: "classic",
    label: "Pipeline classic",
    description: "KPI strip, trend chart, funnels, and pipeline diagnostics.",
  },
  {
    key: "frontline",
    label: "Employee board",
    description: "How sales / prospecting roles experience the overview.",
  },
];

export const DASHBOARD_WIDGET_META: {
  key: DashboardWidgetKey;
  label: string;
  group: "ops" | "shared" | "classic";
}[] = [
  { key: "pulse", label: "Ops pulse strip", group: "ops" },
  { key: "emailVolume", label: "Email volume chart", group: "ops" },
  { key: "followupSchedule", label: "Follow-up schedule chart", group: "ops" },
  { key: "scorecard", label: "Team scorecard", group: "ops" },
  { key: "needsAttention", label: "Needs attention", group: "shared" },
  { key: "inboxPerformance", label: "Top performers", group: "ops" },
  { key: "mailboxUtilization", label: "Inbox utilization", group: "ops" },
  { key: "activityFeed", label: "Live activity", group: "ops" },
  { key: "actionBoard", label: "Action board", group: "ops" },
  { key: "wallLink", label: "Wall mode link", group: "ops" },
  { key: "classicKpis", label: "Classic KPI cards", group: "classic" },
  { key: "pipelineKpis", label: "Pipeline & response KPIs", group: "shared" },
  { key: "replyReviews", label: "Replies to review", group: "shared" },
  { key: "aiBrief", label: "AI brief", group: "shared" },
  { key: "trendChart", label: "Activity trend", group: "classic" },
  { key: "channelFunnels", label: "Channel funnels", group: "shared" },
  { key: "pipelineDistribution", label: "Pipeline distribution", group: "shared" },
  { key: "channelMix", label: "Channel mix", group: "shared" },
  { key: "idleLeads", label: "Idle leads", group: "shared" },
  { key: "campaigns", label: "Outreach campaigns", group: "shared" },
];

export const DEFAULT_DASHBOARD_WIDGETS: DashboardWidgets = {
  pulse: true,
  emailVolume: true,
  followupSchedule: true,
  scorecard: true,
  needsAttention: true,
  inboxPerformance: true,
  mailboxUtilization: true,
  activityFeed: true,
  actionBoard: true,
  replyReviews: true,
  aiBrief: true,
  pipelineKpis: true,
  classicKpis: true,
  trendChart: true,
  channelFunnels: true,
  pipelineDistribution: true,
  channelMix: true,
  idleLeads: true,
  campaigns: true,
  wallLink: true,
};

export const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = {
  viewMode: "auto",
  previewRole: null,
  widgets: { ...DEFAULT_DASHBOARD_WIDGETS },
};

const STORAGE_PREFIX = "nova.dashboard.prefs.v1";

export function dashboardPrefsStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId || "anon"}`;
}

function isRole(value: unknown): value is Role {
  return (
    value === "director" ||
    value === "manager" ||
    value === "team_lead" ||
    value === "salesperson" ||
    value === "data_scraper" ||
    value === "prospecting"
  );
}

export function parseDashboardPreferences(raw: unknown): DashboardPreferences {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_DASHBOARD_PREFERENCES, widgets: { ...DEFAULT_DASHBOARD_WIDGETS } };
  }
  const o = raw as Partial<DashboardPreferences>;
  const viewMode =
    o.viewMode === "ops" || o.viewMode === "classic" || o.viewMode === "frontline" || o.viewMode === "auto"
      ? o.viewMode
      : "auto";
  const previewRole =
    o.previewRole === null || o.previewRole === undefined
      ? null
      : isRole(o.previewRole)
        ? o.previewRole
        : null;
  const widgets = { ...DEFAULT_DASHBOARD_WIDGETS };
  if (o.widgets && typeof o.widgets === "object") {
    for (const key of Object.keys(DEFAULT_DASHBOARD_WIDGETS) as DashboardWidgetKey[]) {
      const v = (o.widgets as Partial<DashboardWidgets>)[key];
      if (typeof v === "boolean") widgets[key] = v;
    }
  }
  return { viewMode, previewRole, widgets };
}

export function loadDashboardPreferences(userId: string): DashboardPreferences {
  if (typeof window === "undefined") {
    return { ...DEFAULT_DASHBOARD_PREFERENCES, widgets: { ...DEFAULT_DASHBOARD_WIDGETS } };
  }
  try {
    const raw = localStorage.getItem(dashboardPrefsStorageKey(userId));
    if (!raw) return { ...DEFAULT_DASHBOARD_PREFERENCES, widgets: { ...DEFAULT_DASHBOARD_WIDGETS } };
    return parseDashboardPreferences(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_DASHBOARD_PREFERENCES, widgets: { ...DEFAULT_DASHBOARD_WIDGETS } };
  }
}

export function saveDashboardPreferences(userId: string, prefs: DashboardPreferences): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(dashboardPrefsStorageKey(userId), JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
}

export function resolveEffectiveDashboardRole(
  realRole: Role | undefined,
  prefs: DashboardPreferences,
): Role | undefined {
  if (prefs.previewRole) return prefs.previewRole;
  if (prefs.viewMode === "frontline") return realRole && isFrontlineLike(realRole) ? realRole : "salesperson";
  if (prefs.viewMode === "ops" || prefs.viewMode === "classic") {
    return realRole ?? "director";
  }
  return realRole;
}

function isFrontlineLike(role: Role): boolean {
  return role === "salesperson" || role === "data_scraper" || role === "prospecting";
}

/** Whether to render the owner ops command board for this preference + role. */
export function resolveOpsLayout(
  realCanOps: boolean,
  effectiveRole: Role | undefined,
  prefs: DashboardPreferences,
): boolean {
  if (prefs.viewMode === "ops") return true;
  if (prefs.viewMode === "classic" || prefs.viewMode === "frontline") return false;
  if (prefs.previewRole) {
    return (
      prefs.previewRole === "director" ||
      prefs.previewRole === "manager" ||
      prefs.previewRole === "team_lead"
    );
  }
  return realCanOps;
}

export function resolveFrontlineLayout(
  effectiveRole: Role | undefined,
  prefs: DashboardPreferences,
): boolean {
  if (prefs.viewMode === "frontline") return true;
  if (prefs.viewMode === "ops" || prefs.viewMode === "classic") return false;
  return (
    effectiveRole === "salesperson" ||
    effectiveRole === "data_scraper" ||
    effectiveRole === "prospecting"
  );
}
