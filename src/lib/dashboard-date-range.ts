import type { ActivityCounterRow, ActivityRecord, Deal, Lead } from "@/lib/types";

export type DashboardTimeRangeKey = "1d" | "7d" | "30d" | "90d" | "qtd" | "ytd";

export const DASHBOARD_TIME_RANGE_LABELS: Record<DashboardTimeRangeKey, string> = {
  "1d": "Last 1 day",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  qtd: "Quarter to date",
  ytd: "Year to date",
};

export function getDashboardRangeStart(key: DashboardTimeRangeKey, now = new Date()): Date {
  const d = new Date(now);
  if (key === "1d") {
    d.setUTCDate(d.getUTCDate() - 1);
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
  now = new Date(),
): Lead[] {
  const start = getDashboardRangeStart(range, now);
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
  now = new Date(),
): Deal[] {
  const start = getDashboardRangeStart(range, now);
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
  now = new Date(),
): ActivityRecord[] {
  const start = getDashboardRangeStart(range, now);
  return records.filter((r) => inRange(r.occurredAt, start));
}

export function filterActivityCountersByDateRange(
  counters: readonly ActivityCounterRow[],
  range: DashboardTimeRangeKey,
  now = new Date(),
): ActivityCounterRow[] {
  const start = getDashboardRangeStart(range, now);
  return counters.filter((r) => inRange(r.date, start));
}
