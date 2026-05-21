import crypto from "crypto";
import {
  aggregateChannelFunnelCounts,
  computeOpenPipelineMetrics,
} from "@/lib/dashboard-analytics";
import { CHANNEL_LIST } from "@/lib/constants";
import { IDLE_LEAD_THRESHOLD_DAYS } from "@/lib/lead-idle";
import type { ChannelKey, Deal, Followup, Lead, LeadPriority, LeadTask, User } from "@/lib/types";
import type { DashboardTimeRangeKey } from "@/lib/dashboard-date-range";

export function buildDashboardFilterHash(input: {
  channelScope: ChannelKey[];
  ownerScope: string;
  timeRange: DashboardTimeRangeKey;
}): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 16);
}

export type DashboardWatchCandidate = {
  title: string;
  reason: string;
  href: string;
  kind: "followup" | "task" | "lead";
  score: number;
};

function priorityScore(priority: LeadPriority | undefined): number {
  switch (priority) {
    case "urgent":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 1;
  }
}

function leadLabel(lead: Lead): string {
  const name = lead.contactName?.trim() || "Contact";
  const company = lead.companyName?.trim();
  return company ? `${name} (${company})` : name;
}

export function buildDashboardWatchCandidates(input: {
  leads: Lead[];
  followups: Followup[];
  leadTasks: LeadTask[];
}): DashboardWatchCandidate[] {
  const leadById = new Map(input.leads.map((l) => [l.id, l]));
  const now = Date.now();
  const candidates: DashboardWatchCandidate[] = [];

  const openFollowups = input.followups.filter((f) => !f.completedAt);
  for (const f of openFollowups) {
    if (f.leadId && !leadById.has(f.leadId)) continue;
    const lead = f.leadId ? leadById.get(f.leadId) : undefined;
    const overdue = new Date(f.dueAt).getTime() < now;
    const daysOverdue = overdue
      ? Math.floor((now - new Date(f.dueAt).getTime()) / (24 * 60 * 60 * 1000))
      : 0;
    const score = priorityScore(f.priority) * 10 + (overdue ? 20 + Math.min(daysOverdue, 14) : 0);
    candidates.push({
      title: lead ? `${leadLabel(lead)} — ${f.title}` : f.title,
      reason: overdue
        ? `Overdue follow-up (${daysOverdue}d) · ${f.priority} priority`
        : `Upcoming follow-up · ${f.priority} priority`,
      href: f.leadId ? `/leads/${f.leadId}` : "/followups",
      kind: "followup",
      score,
    });
  }

  for (const t of input.leadTasks) {
    if (t.completedAt) continue;
    if (t.leadId && !leadById.has(t.leadId)) continue;
    const lead = t.leadId ? leadById.get(t.leadId) : undefined;
    const overdue = t.dueAt && new Date(t.dueAt).getTime() < now;
    const daysOverdue =
      overdue && t.dueAt
        ? Math.floor((now - new Date(t.dueAt).getTime()) / (24 * 60 * 60 * 1000))
        : 0;
    const score = (overdue ? 18 + Math.min(daysOverdue, 14) : 4) + (lead?.priority ? priorityScore(lead.priority) : 0);
    candidates.push({
      title: lead ? `${leadLabel(lead)} — ${t.title}` : t.title,
      reason: overdue
        ? `Overdue task (${daysOverdue}d) · ${t.taskType}`
        : `Open task · ${t.taskType}`,
      href: t.leadId ? `/leads/${t.leadId}` : "/tasks",
      kind: "task",
      score,
    });
  }

  const openLeads = input.leads.filter((l) => !["won", "lost"].includes(l.stage));
  for (const l of openLeads) {
    if (l.isIdle) {
      candidates.push({
        title: leadLabel(l),
        reason: `Idle ${IDLE_LEAD_THRESHOLD_DAYS}+ days · ${l.stage} · ${l.priority} priority`,
        href: `/leads/${l.id}`,
        kind: "lead",
        score: 12 + priorityScore(l.priority),
      });
    } else if (l.priority === "urgent" || l.priority === "high") {
      candidates.push({
        title: leadLabel(l),
        reason: `Active ${l.priority} priority lead · stage ${l.stage}`,
        href: `/leads/${l.id}`,
        kind: "lead",
        score: 8 + priorityScore(l.priority),
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 12);
}

/** Deterministic watch list from scoped candidates (avoids model drift across owner filters). */
export function pickDashboardWatchListFromCandidates(
  candidates: DashboardWatchCandidate[],
  limit = 5,
): { title: string; reason: string; href: string | null }[] {
  return candidates.slice(0, limit).map((c) => ({
    title: c.title,
    reason: c.reason,
    href: c.href,
  }));
}

/** Attach deep links from scoped candidates when the model omits or mismatches href. */
export function enrichDashboardWatchList(
  watchList: { title: string; reason: string; href: string | null }[],
  candidates: DashboardWatchCandidate[],
): { title: string; reason: string; href: string | null }[] {
  if (!candidates.length) return watchList;

  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

  return watchList.map((item) => {
    if (item.href?.startsWith("/")) return item;

    const titleNorm = normalize(item.title);
    let best: DashboardWatchCandidate | undefined;
    let bestScore = 0;

    for (const c of candidates) {
      const cNorm = normalize(c.title);
      let score = 0;
      if (cNorm === titleNorm) score = 100;
      else if (cNorm.includes(titleNorm) || titleNorm.includes(cNorm)) score = 60;
      else {
        const words = titleNorm.split(" ").filter((w) => w.length > 3);
        const hits = words.filter((w) => cNorm.includes(w)).length;
        score = hits >= 2 ? 40 + hits : 0;
      }
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    if (best && bestScore >= 40) {
      return { ...item, href: best.href };
    }
    return item;
  });
}

export function buildDashboardAiContext(input: {
  leads: Lead[];
  deals: Deal[];
  followups: Followup[];
  leadTasks: LeadTask[];
  users: User[];
  channelScope: ChannelKey[];
  ownerLabel: string;
  timeRange: DashboardTimeRangeKey;
}): string {
  const { leads, deals, followups, leadTasks } = input;
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const openLeads = leads.filter((l) => !["won", "lost"].includes(l.stage));
  const idle = leads.filter((l) => l.isIdle);
  const pipeline = computeOpenPipelineMetrics(leads, deals);
  const won = deals.filter((d) => d.stage === "won");
  const closedValue = won.reduce((s, d) => s + d.value, 0);

  const openFollowups = followups.filter((f) => !f.completedAt);
  const overdueFollowups = openFollowups
    .filter((f) => new Date(f.dueAt).getTime() < Date.now())
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
    .slice(0, 12)
    .map((f) => {
      const lead = f.leadId ? leadById.get(f.leadId) : undefined;
      return {
        title: f.title,
        leadName: lead ? leadLabel(lead) : null,
        dueAt: f.dueAt,
        priority: f.priority,
        leadId: f.leadId,
        href: f.leadId ? `/leads/${f.leadId}` : "/followups",
      };
    });

  const overdueTasks = leadTasks
    .filter((t) => !t.completedAt && t.dueAt && new Date(t.dueAt).getTime() < Date.now())
    .slice(0, 12)
    .map((t) => {
      const lead = t.leadId ? leadById.get(t.leadId) : undefined;
      return {
        title: t.title,
        leadName: lead ? leadLabel(lead) : null,
        dueAt: t.dueAt,
        taskType: t.taskType,
        leadId: t.leadId,
        href: t.leadId ? `/leads/${t.leadId}` : "/tasks",
      };
    });

  const watchListCandidates = buildDashboardWatchCandidates({
    leads,
    followups,
    leadTasks,
  });

  const channels =
    input.channelScope.length > 0
      ? input.channelScope
      : (CHANNEL_LIST.map((c) => c.key) as ChannelKey[]);

  const funnelSummary = channels.map((key) => {
    const meta = CHANNEL_LIST.find((c) => c.key === key);
    const counts = aggregateChannelFunnelCounts(key, [], leads, deals);
    return { channel: meta?.label ?? key, stages: counts };
  });

  const byStage: Record<string, number> = {};
  for (const l of leads) {
    byStage[l.stage] = (byStage[l.stage] ?? 0) + 1;
  }

  const payload = {
    scopeNote: `All metrics and watch-list candidates are scoped to: ${input.ownerLabel} · ${input.timeRange}. Do not reference people, leads, or tasks outside this scope.`,
    filters: {
      channels: input.channelScope,
      owner: input.ownerLabel,
      timeRange: input.timeRange,
    },
    kpis: {
      openLeads: openLeads.length,
      idleLeads: idle.length,
      idleThresholdDays: IDLE_LEAD_THRESHOLD_DAYS,
      pipelineValue: pipeline.total,
      closedValue,
      wonDeals: won.length,
      avgResponseMinutes:
        leads.filter((l) => l.responseTimeMinutes != null).reduce((s, l) => s + (l.responseTimeMinutes ?? 0), 0) /
        Math.max(1, leads.filter((l) => l.responseTimeMinutes != null).length),
    },
    stageDistribution: byStage,
    funnelSummary,
    overdueFollowups,
    overdueTasks,
    watchListCandidates,
    teamSize: input.users.length,
    sampleIdleLeads: idle.slice(0, 8).map((l) => ({
      id: l.id,
      label: leadLabel(l),
      stage: l.stage,
      channel: l.channel,
      priority: l.priority,
      ownerId: l.ownerId,
      lastActivityAt: l.lastActivityAt,
      href: `/leads/${l.id}`,
    })),
  };

  const json = JSON.stringify(payload);
  return json.length > 14_000 ? json.slice(0, 14_000) + "…[truncated]" : json;
}
