import { CHANNEL_FUNNELS } from "@/lib/constants";
import type { ActivityCounterRow, ActivityRecord, ChannelKey, Deal, Lead } from "@/lib/types";

/** Normalize integration counter keys to funnel stage keys. */
function normalizeCounterToStageKey(channel: ChannelKey, rawKey: string): string | null {
  if (channel === "upwork" && (rawKey === "applies_sent" || rawKey === "applied")) return "applied";
  return rawKey;
}

function dealsForChannel(leads: Lead[], deals: Deal[], channel: ChannelKey): Deal[] {
  const leadIds = new Set(leads.filter((l) => l.channel === channel).map((l) => l.id));
  return deals.filter((d) => leadIds.has(d.leadId));
}

/**
 * Open pipeline $ = sum of open (not won/lost) deal values, plus estimated value on
 * open leads that do not yet have any open deal. Avoids double-counting once a deal exists.
 */
export function computeOpenPipelineMetrics(leads: Lead[], deals: Deal[]) {
  const openDeals = deals.filter((d) => !["won", "lost"].includes(d.stage));
  const leadIdsWithOpenDeal = new Set(openDeals.map((d) => d.leadId));
  const fromDeals = openDeals.reduce((s, d) => s + d.value, 0);
  const openLeadsWithoutOpenDeal = leads.filter(
    (l) => !["won", "lost"].includes(l.stage) && !leadIdsWithOpenDeal.has(l.id),
  );
  const fromLeadEstimates = openLeadsWithoutOpenDeal.reduce((s, l) => s + (l.estimatedValue ?? 0), 0);
  const leadEstimateContributors = openLeadsWithoutOpenDeal.filter((l) => (l.estimatedValue ?? 0) > 0).length;

  return {
    total: fromDeals + fromLeadEstimates,
    openDealCount: openDeals.length,
    leadEstimateContributors,
  };
}

/** Same rules as {@link computeOpenPipelineMetrics}, scoped to one user (deal owner + lead owner). */
export function computeUserOpenPipelineMetrics(userId: string, leads: Lead[], deals: Deal[]) {
  const openDeals = deals.filter((d) => !["won", "lost"].includes(d.stage));
  const leadIdsWithOpenDeal = new Set(openDeals.map((d) => d.leadId));
  const userOpenDeals = openDeals.filter((d) => d.ownerId === userId);
  const fromDeals = userOpenDeals.reduce((s, d) => s + d.value, 0);
  const ownedOpenLeadsNoDeal = leads.filter(
    (l) =>
      l.ownerId === userId && !["won", "lost"].includes(l.stage) && !leadIdsWithOpenDeal.has(l.id),
  );
  const fromLeadEstimates = ownedOpenLeadsNoDeal.reduce((s, l) => s + (l.estimatedValue ?? 0), 0);
  const leadEstimateContributors = ownedOpenLeadsNoDeal.filter((l) => (l.estimatedValue ?? 0) > 0).length;

  return {
    total: fromDeals + fromLeadEstimates,
    openDealCount: userOpenDeals.length,
    leadEstimateContributors,
  };
}

/**
 * Funnel stage counts for one channel, derived only from workspace-scoped
 * activity rollups and pipeline (leads/deals the viewer may already see).
 */
export function aggregateChannelFunnelCounts(
  channel: ChannelKey,
  activityCounters: ActivityCounterRow[],
  leads: Lead[],
  deals: Deal[],
): Record<string, number> {
  const stages = CHANNEL_FUNNELS[channel];
  const counts: Record<string, number> = Object.fromEntries(stages.map((s) => [s.key, 0])) as Record<string, number>;

  for (const row of activityCounters) {
    if (row.channel !== channel) continue;
    for (const [rawKey, val] of Object.entries(row.counters)) {
      if (typeof val !== "number" || !Number.isFinite(val)) continue;
      const nk = normalizeCounterToStageKey(channel, rawKey);
      if (nk && nk in counts) counts[nk] += val;
    }
  }

  const chLeads = leads.filter((l) => l.channel === channel);
  const chDeals = dealsForChannel(leads, deals, channel);
  const volume = chLeads.length;
  const firstKey = stages[0]?.key;
  if (firstKey && (counts[firstKey] ?? 0) === 0 && volume > 0) {
    counts[firstKey] = volume;
  }

  const winDeals = chDeals.filter((d) => d.stage === "won").length;
  const meetingLeads = chLeads.filter((l) =>
    ["qualified", "discovery", "proposal", "negotiation"].includes(l.stage),
  ).length;

  if ("meeting" in counts) counts.meeting = Math.max(counts.meeting ?? 0, meetingLeads);

  if ("closed" in counts) counts.closed = Math.max(counts.closed ?? 0, winDeals);

  if (channel === "website_form") {
    counts.contacted = Math.max(
      counts.contacted ?? 0,
      chLeads.filter((l) => l.stage !== "new").length,
    );
  }

  if (channel === "upwork") {
    counts.hired = Math.max(counts.hired ?? 0, winDeals);
    counts.revenue = Math.max(counts.revenue ?? 0, chDeals.filter((d) => d.stage === "won").length);
  }

  let cap = Infinity;
  for (const s of stages) {
    const v = counts[s.key] ?? 0;
    const next = Math.min(v, cap);
    counts[s.key] = next;
    cap = next;
  }

  return counts;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Last N calendar days as ISO date keys (local). */
function rollingDayKeys(days: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

export type ActivityTrendPoint = {
  day: string;
  replies: number;
  meetings: number;
  closed: number;
  newLeads: number;
};

/**
 * Daily activity trend from scoped records + won deals (no synthetic global series).
 */
export function buildActivityTrendSeries(
  activityRecords: ActivityRecord[],
  deals: Deal[],
  leads: Lead[],
  days = 30,
): ActivityTrendPoint[] {
  const keys = rollingDayKeys(days);
  const byDay = new Map<string, { replies: number; meetings: number; closed: number; newLeads: number }>();
  for (const k of keys) byDay.set(k, { replies: 0, meetings: 0, closed: 0, newLeads: 0 });

  for (const r of activityRecords) {
    const k = dayKey(r.occurredAt);
    const b = byDay.get(k);
    if (!b) continue;
    b.replies += 1;
    const s = `${r.type} ${r.summary ?? ""}`.toLowerCase();
    if (s.includes("meet") || s.includes("demo") || s.includes("call")) b.meetings += 1;
  }

  const visibleLeadIds = new Set(leads.map((l) => l.id));
  for (const d of deals) {
    if (d.stage !== "won" || !d.wonAt) continue;
    if (!visibleLeadIds.has(d.leadId)) continue;
    const k = dayKey(d.wonAt);
    const b = byDay.get(k);
    if (b) b.closed += 1;
  }

  for (const l of leads) {
    const k = dayKey(l.createdAt);
    const b = byDay.get(k);
    if (b) b.newLeads += 1;
  }

  return keys.map((k) => {
    const d = new Date(k + "T12:00:00");
    return {
      day: d.toLocaleDateString("en", { month: "short", day: "numeric" }),
      ...byDay.get(k)!,
    };
  });
}
