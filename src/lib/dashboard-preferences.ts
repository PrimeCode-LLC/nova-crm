import { CHANNEL_LIST } from "@/lib/constants";
import type { ChannelKey, Role } from "@/lib/types";
import { isContentOpsDashboardRole, isFrontlineDashboardRole } from "@/lib/dashboard-role-focus";

/** Layout presets an owner can pick or preview. */
export type DashboardViewMode = "auto" | "ops" | "classic" | "frontline" | "content";

export type DashboardWidgetKey =
  | "pulse"
  | "emailVolume"
  | "followupSchedule"
  | "teamCommand"
  | "strategyScoreboard"
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

/** Per-channel visibility inside the Channel funnels section. */
export type ChannelFunnelsVisibility = Record<ChannelKey, boolean>;

/**
 * Per-strategy visibility on the Strategy scoreboard.
 * Missing ids default to visible (true). Only published strategies are candidates.
 */
export type StrategyScoreboardVisibility = Record<string, boolean>;

/**
 * Per-mailbox visibility on Inbox utilization.
 * Missing ids default to visible (true).
 */
export type MailboxUtilizationVisibility = Record<string, boolean>;

export type DashboardPreferences = {
  viewMode: DashboardViewMode;
  /** When set (owners only), layout follows this CRM role instead of the real viewer. */
  previewRole: Role | null;
  widgets: DashboardWidgets;
  /** Which channel cards appear in Channel funnels (independent of dashboard channel filter). */
  channelFunnelsVisible: ChannelFunnelsVisibility;
  /** Which published strategies appear on the Strategy scoreboard. */
  strategyScoreboardVisible: StrategyScoreboardVisibility;
  /**
   * Which mailboxes appear on Inbox utilization.
   * Keys are `${ownerUid}:${mailboxId}`. Missing ids default to visible.
   */
  mailboxUtilizationVisible: MailboxUtilizationVisibility;
};

export const DASHBOARD_VIEW_MODE_OPTIONS: {
  key: DashboardViewMode;
  label: string;
  description: string;
}[] = [
  {
    key: "auto",
    label: "Auto (my role)",
    description: "Uses your real role - ops for owners/managers, personal for frontline.",
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
  {
    key: "content",
    label: "Content board",
    description: "Checklist plate and calendar home — no sales pipeline widgets.",
  },
];

export const DASHBOARD_WIDGET_META: {
  key: DashboardWidgetKey;
  label: string;
  group: "ops" | "shared" | "classic";
}[] = [
  { key: "pulse", label: "Pulse strip", group: "shared" },
  { key: "emailVolume", label: "Email volume chart", group: "ops" },
  { key: "followupSchedule", label: "Follow-up schedule chart", group: "ops" },
  { key: "teamCommand", label: "Team command", group: "ops" },
  { key: "strategyScoreboard", label: "Strategy scoreboard", group: "ops" },
  { key: "scorecard", label: "Team scorecard", group: "ops" },
  { key: "needsAttention", label: "Needs attention", group: "shared" },
  { key: "inboxPerformance", label: "Top performers", group: "ops" },
  { key: "mailboxUtilization", label: "Inbox utilization", group: "ops" },
  { key: "activityFeed", label: "Live activity", group: "ops" },
  { key: "actionBoard", label: "Action board / My day", group: "shared" },
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
  teamCommand: true,
  strategyScoreboard: true,
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

export const DEFAULT_CHANNEL_FUNNELS_VISIBLE: ChannelFunnelsVisibility = Object.fromEntries(
  CHANNEL_LIST.map((c) => [c.key, true]),
) as ChannelFunnelsVisibility;

export function defaultDashboardPreferences(): DashboardPreferences {
  return {
    viewMode: "auto",
    previewRole: null,
    widgets: { ...DEFAULT_DASHBOARD_WIDGETS },
    channelFunnelsVisible: { ...DEFAULT_CHANNEL_FUNNELS_VISIBLE },
    strategyScoreboardVisible: {},
    mailboxUtilizationVisible: {},
  };
}

/** Missing key → visible. Explicit false hides the strategy. */
export function isStrategyScoreboardVisible(
  visible: StrategyScoreboardVisibility,
  strategyId: string,
): boolean {
  return visible[strategyId] !== false;
}

export function mailboxUtilizationPrefsKey(ownerUid: string, mailboxId: string): string {
  return `${ownerUid}:${mailboxId}`;
}

/** Missing key → visible. Explicit false hides the mailbox. */
export function isMailboxUtilizationVisible(
  visible: MailboxUtilizationVisibility | null | undefined,
  ownerUid: string,
  mailboxId: string,
): boolean {
  return visible?.[mailboxUtilizationPrefsKey(ownerUid, mailboxId)] !== false;
}

export const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = defaultDashboardPreferences();

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
    value === "prospecting" ||
    value === "content_team"
  );
}

function parseChannelFunnelsVisible(raw: unknown): ChannelFunnelsVisibility {
  const visible = { ...DEFAULT_CHANNEL_FUNNELS_VISIBLE };
  if (!raw || typeof raw !== "object") return visible;
  const o = raw as Partial<Record<ChannelKey, unknown>>;
  for (const { key } of CHANNEL_LIST) {
    if (typeof o[key] === "boolean") visible[key] = o[key];
  }
  return visible;
}

export function parseDashboardPreferences(raw: unknown): DashboardPreferences {
  if (!raw || typeof raw !== "object") {
    return defaultDashboardPreferences();
  }
  const o = raw as Partial<DashboardPreferences>;
  const viewMode =
    o.viewMode === "ops" ||
    o.viewMode === "classic" ||
    o.viewMode === "frontline" ||
    o.viewMode === "content" ||
    o.viewMode === "auto"
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
  const strategyScoreboardVisible: StrategyScoreboardVisibility = {};
  if (o.strategyScoreboardVisible && typeof o.strategyScoreboardVisible === "object") {
    for (const [id, v] of Object.entries(o.strategyScoreboardVisible)) {
      if (typeof v === "boolean") strategyScoreboardVisible[id] = v;
    }
  }
  const mailboxUtilizationVisible: MailboxUtilizationVisibility = {};
  if (o.mailboxUtilizationVisible && typeof o.mailboxUtilizationVisible === "object") {
    for (const [id, v] of Object.entries(o.mailboxUtilizationVisible)) {
      if (typeof v === "boolean") mailboxUtilizationVisible[id] = v;
    }
  }

  return {
    viewMode,
    previewRole,
    widgets,
    channelFunnelsVisible: parseChannelFunnelsVisible(o.channelFunnelsVisible),
    strategyScoreboardVisible,
    mailboxUtilizationVisible,
  };
}

export function loadDashboardPreferences(userId: string): DashboardPreferences {
  if (typeof window === "undefined") {
    return defaultDashboardPreferences();
  }
  try {
    const raw = localStorage.getItem(dashboardPrefsStorageKey(userId));
    if (!raw) return defaultDashboardPreferences();
    return parseDashboardPreferences(JSON.parse(raw) as unknown);
  } catch {
    return defaultDashboardPreferences();
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
  if (prefs.viewMode === "content") return realRole === "content_team" ? realRole : "content_team";
  if (prefs.viewMode === "ops" || prefs.viewMode === "classic") {
    return realRole ?? "director";
  }
  return realRole;
}

function isFrontlineLike(role: Role): boolean {
  return isFrontlineDashboardRole(role);
}

/** Whether to render the owner ops command board for this preference + role. */
export function resolveOpsLayout(
  realCanOps: boolean,
  effectiveRole: Role | undefined,
  prefs: DashboardPreferences,
): boolean {
  if (prefs.viewMode === "ops") return true;
  if (
    prefs.viewMode === "classic" ||
    prefs.viewMode === "frontline" ||
    prefs.viewMode === "content"
  ) {
    return false;
  }
  if (prefs.previewRole) {
    return (
      prefs.previewRole === "director" ||
      prefs.previewRole === "manager" ||
      prefs.previewRole === "team_lead"
    );
  }
  if (isContentOpsDashboardRole(effectiveRole)) return false;
  return realCanOps;
}

export function resolveFrontlineLayout(
  effectiveRole: Role | undefined,
  prefs: DashboardPreferences,
): boolean {
  if (prefs.viewMode === "frontline") return true;
  if (
    prefs.viewMode === "ops" ||
    prefs.viewMode === "classic" ||
    prefs.viewMode === "content"
  ) {
    return false;
  }
  return isFrontlineDashboardRole(effectiveRole);
}

/** Content-ops home: checklist plate + calendar, no sales KPIs. */
export function resolveContentLayout(
  effectiveRole: Role | undefined,
  prefs: DashboardPreferences,
): boolean {
  if (prefs.viewMode === "content") return true;
  if (
    prefs.viewMode === "ops" ||
    prefs.viewMode === "classic" ||
    prefs.viewMode === "frontline"
  ) {
    return false;
  }
  return isContentOpsDashboardRole(effectiveRole);
}
