import { CHANNEL_FUNNELS } from "@/lib/constants";
import { categoryForAuditEvent } from "@/lib/firestore/audit-events";
import { projectLegacyAuditRow } from "@/lib/firestore/audit-detail";
import type { AuditLogRecord } from "@/lib/firestore/audit";
import type { ChannelKey } from "@/lib/types";

export type AuditAnalyticsRangeKey = "1d" | "7d" | "30d" | "90d" | "custom";

export type AuditAnalyticsKpis = {
  totalEvents: number;
  stageChanges: number;
  leadsCreated: number;
  dealsCreated: number;
  dealsWon: number;
  dealsLost: number;
  countersLogged: number;
  aiActions: number;
  integrationActions: number;
  pageViews: number;
  teamActions: number;
};

export type AuditChannelFunnel = {
  channel: string;
  stages: Record<string, number>;
};

export type AuditPersonRow = {
  actorUid: string;
  totalEvents: number;
  stageChanges: number;
  leadsCreated: number;
  countersLogged: number;
};

export type AuditDailyPoint = {
  day: string;
  count: number;
};

export type AuditAnalyticsResult = {
  kpis: AuditAnalyticsKpis;
  byCategory: Record<string, number>;
  byEvent: Record<string, number>;
  channelFunnels: AuditChannelFunnel[];
  stageTransitions: { label: string; count: number }[];
  dailyTrend: AuditDailyPoint[];
  byPerson: AuditPersonRow[];
};

function dayKey(iso: string | null): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

function stageLabelFromRow(row: ReturnType<typeof projectLegacyAuditRow>): string | null {
  return row.updatedValue ?? (typeof row.meta.nextStage === "string" ? row.meta.nextStage : null);
}

function channelFromMeta(meta: Record<string, unknown>): string | null {
  return typeof meta.channel === "string" ? meta.channel : null;
}

function countersFromRow(row: ReturnType<typeof projectLegacyAuditRow>): Record<string, number> {
  const raw = row.meta.counters;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** Map pipeline stage labels to Upwork-style funnel keys for audit-derived metrics. */
function pipelineStageToFunnelKey(channel: string, stageLabel: string): string | null {
  const normalized = stageLabel.toLowerCase();
  if (channel === "upwork" || channel === "job_apply") {
    if (normalized === "new") return "applied";
    if (normalized === "viewed") return "viewed";
    if (normalized === "contacted") return "viewed";
    if (normalized === "replied") return "replied";
    if (normalized === "won") return channel === "upwork" ? "hired" : "offer";
  }
  if (normalized === "won") return "closed";
  if (["qualified", "discovery", "proposal", "negotiation"].includes(normalized)) {
    return "meeting";
  }
  if (normalized === "replied") return "replied";
  if (normalized === "viewed") return "viewed";
  if (normalized === "contacted") return "contacted";
  if (normalized === "new") return "sent";
  return null;
}

export function aggregateAuditAnalytics(
  rows: AuditLogRecord[],
  channelFilter?: string,
): AuditAnalyticsResult {
  const projected = rows.map(projectLegacyAuditRow);

  const kpis: AuditAnalyticsKpis = {
    totalEvents: projected.length,
    stageChanges: 0,
    leadsCreated: 0,
    dealsCreated: 0,
    dealsWon: 0,
    dealsLost: 0,
    countersLogged: 0,
    aiActions: 0,
    integrationActions: 0,
    pageViews: 0,
    teamActions: 0,
  };

  const byCategory: Record<string, number> = {};
  const byEvent: Record<string, number> = {};
  const stageTransitionCounts = new Map<string, number>();
  const dailyCounts = new Map<string, number>();
  const personMap = new Map<string, AuditPersonRow>();
  const funnelByChannel = new Map<string, Record<string, number>>();

  for (const row of projected) {
    const cat = categoryForAuditEvent(row.event);
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    byEvent[row.event] = (byEvent[row.event] ?? 0) + 1;

    const dk = dayKey(row.createdAt);
    if (dk) dailyCounts.set(dk, (dailyCounts.get(dk) ?? 0) + 1);

    const person =
      personMap.get(row.actorUid) ??
      ({
        actorUid: row.actorUid,
        totalEvents: 0,
        stageChanges: 0,
        leadsCreated: 0,
        countersLogged: 0,
      } satisfies AuditPersonRow);
    person.totalEvents += 1;

    if (row.event === "lead.stage_changed") {
      kpis.stageChanges += 1;
      person.stageChanges += 1;
      const label = stageLabelFromRow(row);
      if (label) {
        const key = `${row.prevValue ?? "?"} → ${label}`;
        stageTransitionCounts.set(key, (stageTransitionCounts.get(key) ?? 0) + 1);
      }
      const ch = channelFromMeta(row.meta);
      if (ch && (!channelFilter || ch === channelFilter)) {
        const funnelKey = label ? pipelineStageToFunnelKey(ch, label) : null;
        if (funnelKey) {
          const bucket = funnelByChannel.get(ch) ?? {};
          bucket[funnelKey] = (bucket[funnelKey] ?? 0) + 1;
          funnelByChannel.set(ch, bucket);
        }
      }
    }

    if (row.event === "lead.created") {
      kpis.leadsCreated += 1;
      person.leadsCreated += 1;
      const ch = channelFromMeta(row.meta);
      if (ch && (!channelFilter || ch === channelFilter)) {
        const bucket = funnelByChannel.get(ch) ?? {};
        bucket.applied = (bucket.applied ?? 0) + 1;
        funnelByChannel.set(ch, bucket);
      }
    }

    if (row.event === "deal.created") kpis.dealsCreated += 1;
    if (row.event === "deal.won") {
      kpis.dealsWon += 1;
      const ch = channelFromMeta(row.meta);
      if (ch && (!channelFilter || ch === channelFilter)) {
        const bucket = funnelByChannel.get(ch) ?? {};
        bucket.hired = (bucket.hired ?? 0) + 1;
        bucket.closed = (bucket.closed ?? 0) + 1;
        funnelByChannel.set(ch, bucket);
      }
    }
    if (row.event === "deal.lost") kpis.dealsLost += 1;

    if (row.event === "activity.counter_logged") {
      kpis.countersLogged += 1;
      person.countersLogged += 1;
      const ch = channelFromMeta(row.meta) ?? "unknown";
      if (!channelFilter || ch === channelFilter) {
        const bucket = funnelByChannel.get(ch) ?? {};
        for (const [k, v] of Object.entries(countersFromRow(row))) {
          bucket[k] = (bucket[k] ?? 0) + v;
        }
        funnelByChannel.set(ch, bucket);
      }
    }

    if (cat === "ai" || (row.event.startsWith("feature.") && row.event !== "feature.page_view")) {
      kpis.aiActions += 1;
    }
    if (row.event === "feature.page_view") kpis.pageViews += 1;
    if (cat === "integrations") kpis.integrationActions += 1;
    if (cat === "team") kpis.teamActions += 1;

    personMap.set(row.actorUid, person);
  }

  const channelFunnels: AuditChannelFunnel[] = [...funnelByChannel.entries()]
    .map(([channel, stages]) => {
      const known = CHANNEL_FUNNELS[channel as ChannelKey];
      if (known) {
        const ordered: Record<string, number> = {};
        for (const s of known) {
          ordered[s.key] = stages[s.key] ?? 0;
        }
        for (const [k, v] of Object.entries(stages)) {
          if (!(k in ordered)) ordered[k] = v;
        }
        return { channel, stages: ordered };
      }
      return { channel, stages };
    })
    .sort((a, b) => a.channel.localeCompare(b.channel));

  const stageTransitions = [...stageTransitionCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const dailyTrend = [...dailyCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({
      day: new Date(day + "T12:00:00").toLocaleDateString("en", { month: "short", day: "numeric" }),
      count,
    }));

  const byPerson = [...personMap.values()].sort((a, b) => b.totalEvents - a.totalEvents);

  return {
    kpis,
    byCategory,
    byEvent,
    channelFunnels,
    stageTransitions,
    dailyTrend,
    byPerson,
  };
}

export function parseAuditAnalyticsRange(
  range: string | null,
  fromParam: string | null,
  toParam: string | null,
  now = new Date(),
): { fromIso: string; toIso: string; key: AuditAnalyticsRangeKey } {
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const toIso = to.toISOString();

  if (range === "custom" && fromParam) {
    const from = new Date(fromParam + "T00:00:00");
    const toCustom = toParam ? new Date(toParam + "T23:59:59") : to;
    return { fromIso: from.toISOString(), toIso: toCustom.toISOString(), key: "custom" };
  }

  const start = new Date(now);
  if (range === "1d") start.setDate(start.getDate() - 1);
  else if (range === "7d") start.setDate(start.getDate() - 7);
  else if (range === "90d") start.setDate(start.getDate() - 90);
  else start.setDate(start.getDate() - 30);

  start.setHours(0, 0, 0, 0);
  const key: AuditAnalyticsRangeKey =
    range === "1d" || range === "7d" || range === "90d" ? range : range === "custom" ? "custom" : "30d";

  return { fromIso: start.toISOString(), toIso, key };
}
