import type { ActivityCounterRow, ActivityRecord, Deal, Lead } from "@/lib/types";
import { resolveOrgTimezone, startOfZonedDay } from "@/lib/org-timezone";

export type DashboardTimeRangeKey =
  | "today"
  | "12h"
  | "1d"
  | "7d"
  | "30d"
  | "90d"
  | "qtd"
  | "ytd"
  | "all";

export const DASHBOARD_TIME_RANGE_LABELS: Record<DashboardTimeRangeKey, string> = {
  today: "Today",
  "12h": "Last 12 hours",
  "1d": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  qtd: "Quarter to date",
  ytd: "Year to date",
  all: "All time",
};

/** Compact presets shown on Team Command (and similar ops widgets). */
export const TEAM_COMMAND_TIME_RANGES = ["today", "12h", "1d", "7d", "30d", "all"] as const;
export type TeamCommandTimeRangeKey = (typeof TEAM_COMMAND_TIME_RANGES)[number];

export const TEAM_COMMAND_TIME_RANGE_SHORT_LABELS: Record<TeamCommandTimeRangeKey, string> = {
  today: "Today",
  "12h": "12h",
  "1d": "24h",
  "7d": "7d",
  "30d": "30d",
  all: "All",
};

export type DashboardRangeOptions = {
  now?: Date;
  /** IANA zone for calendar “Today” (org sticky or browser). */
  timeZone?: string;
};

/**
 * Inclusive range start for dashboard metrics.
 * `today` = start of the calendar day in `timeZone` (org/browser), not a rolling 24h window.
 */
export function getDashboardRangeStart(
  key: DashboardTimeRangeKey,
  nowOrOpts: Date | DashboardRangeOptions = new Date(),
): Date {
  const opts: DashboardRangeOptions =
    nowOrOpts instanceof Date ? { now: nowOrOpts } : nowOrOpts;
  const now = opts.now ?? new Date();

  if (key === "all") {
    return new Date(0);
  }
  if (key === "today") {
    return startOfZonedDay(now, resolveOrgTimezone(opts.timeZone));
  }
  const d = new Date(now);
  if (key === "12h") {
    d.setTime(d.getTime() - 12 * 60 * 60 * 1000);
    return d;
  }
  if (key === "1d") {
    d.setTime(d.getTime() - 24 * 60 * 60 * 1000);
    return d;
  }
  if (key === "7d") {
    d.setUTCDate(d.getUTCDate() - 7);
    return d;
  }
  if (key === "30d") {
    d.setUTCDate(d.getUTCDate() - 30);
    return d;
  }
  if (key === "90d") {
    d.setUTCDate(d.getUTCDate() - 90);
    return d;
  }
  if (key === "qtd") {
    const month = d.getUTCMonth();
    const qStartMonth = Math.floor(month / 3) * 3;
    return new Date(Date.UTC(d.getUTCFullYear(), qStartMonth, 1));
  }
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}

function inRange(iso: string | undefined, start: Date): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= start.getTime();
}

/** Leads with activity or creation in range, plus still-open pipeline rows. */
export function filterLeadsByDateRange(
  leads: readonly Lead[],
  range: DashboardTimeRangeKey,
  nowOrOpts: Date | DashboardRangeOptions = new Date(),
): Lead[] {
  const opts: DashboardRangeOptions =
    nowOrOpts instanceof Date ? { now: nowOrOpts } : nowOrOpts;
  const start = getDashboardRangeStart(range, opts);
  return leads.filter((l) => {
    const open = !["won", "lost"].includes(l.stage);
    if (open) return true;
    return (
      inRange(l.lastActivityAt, start) ||
      inRange(l.updatedAt, start) ||
      inRange(l.createdAt, start)
    );
  });
}

export function filterDealsByDateRange(
  deals: readonly Deal[],
  range: DashboardTimeRangeKey,
  nowOrOpts: Date | DashboardRangeOptions = new Date(),
): Deal[] {
  const opts: DashboardRangeOptions =
    nowOrOpts instanceof Date ? { now: nowOrOpts } : nowOrOpts;
  const start = getDashboardRangeStart(range, opts);
  return deals.filter(
    (d) =>
      inRange(d.updatedAt, start) ||
      inRange(d.createdAt, start) ||
      (!["won", "lost"].includes(d.stage) && inRange(d.expectedCloseDate, start)),
  );
}

export function filterActivityRecordsByDateRange(
  records: readonly ActivityRecord[],
  range: DashboardTimeRangeKey,
  nowOrOpts: Date | DashboardRangeOptions = new Date(),
): ActivityRecord[] {
  const opts: DashboardRangeOptions =
    nowOrOpts instanceof Date ? { now: nowOrOpts } : nowOrOpts;
  const start = getDashboardRangeStart(range, opts);
  return records.filter((r) => inRange(r.occurredAt, start));
}

export function filterActivityCountersByDateRange(
  counters: readonly ActivityCounterRow[],
  range: DashboardTimeRangeKey,
  nowOrOpts: Date | DashboardRangeOptions = new Date(),
): ActivityCounterRow[] {
  const opts: DashboardRangeOptions =
    nowOrOpts instanceof Date ? { now: nowOrOpts } : nowOrOpts;
  const start = getDashboardRangeStart(range, opts);
  return counters.filter((r) => inRange(r.date, start));
}
