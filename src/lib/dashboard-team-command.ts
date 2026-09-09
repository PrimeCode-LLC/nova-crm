import { getDashboardRangeStart, type DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import { isSalesLead } from "@/lib/dashboard-workflow";
import type { Deal, Followup, Lead, LeadTask, User } from "@/lib/types";

export const TEAM_COMMAND_LENSES = ["overall", "leadgen", "outreach", "followups", "closing"] as const;
export type TeamCommandLens = (typeof TEAM_COMMAND_LENSES)[number];

/** Blend weights for the Overall composite (must sum to 1). */
const OVERALL_WEIGHTS: Record<Exclude<TeamCommandLens, "overall">, number> = {
  leadgen: 0.25,
  outreach: 0.3,
  followups: 0.15,
  closing: 0.3,
};

export type TeamCommandRow = {
  userId: string;
  // Lead-gen / prospecting (window-scoped)
  prospectsAdded: number;
  qualifiedProspects: number;
  avgQuality: number | null;
  qualityWeighted: number;
  strategyAttributed: number;
  salesLeadsAdded: number;
  // Outreach (window-scoped)
  emailsSent: number;
  replies: number;
  replyRate: number;
  /** Open failed / needs_retry deliveries (not window-scoped - current state). */
  failed: number;
  // Follow-ups
  followupsCompleted: number;
  scheduled: number;
  // Closing (new pipeline + closed/won are window-scoped)
  pipelineAdded: number;
  closedValue: number;
  wonCount: number;
  /** 0–100, team-normalized per lens. */
  scores: Record<TeamCommandLens, number>;
  /** Change in normalized score vs the previous equal-length window. */
  deltas: Record<TeamCommandLens, number>;
  /** Short owner-facing callout when a rep is a clear bottleneck. */
  bottleneck: string | null;
};

type RawMetrics = {
  userId: string;
  prospectsAdded: number;
  qualifiedProspects: number;
  qualitySum: number;
  qualityScored: number;
  qualityWeighted: number;
  strategyAttributed: number;
  salesLeadsAdded: number;
  emailsSent: number;
  replies: number;
  followupsCompleted: number;
  scheduled: number;
  failed: number;
  pipelineAdded: number;
  closedValue: number;
  wonCount: number;
};

type LensRaw = Record<Exclude<TeamCommandLens, "overall">, number>;

function validTime(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : undefined;
}

function inWindow(iso: string | undefined, start: number, end: number): boolean {
  const t = validTime(iso);
  return t !== undefined && t >= start && t < end;
}

function emptyRawMetrics(userId: string): RawMetrics {
  return {
    userId,
    prospectsAdded: 0,
    qualifiedProspects: 0,
    qualitySum: 0,
    qualityScored: 0,
    qualityWeighted: 0,
    strategyAttributed: 0,
    salesLeadsAdded: 0,
    emailsSent: 0,
    replies: 0,
    followupsCompleted: 0,
    scheduled: 0,
    failed: 0,
    pipelineAdded: 0,
    closedValue: 0,
    wonCount: 0,
  };
}

function ensureMetrics(map: Map<string, RawMetrics>, userId: string): RawMetrics {
  let row = map.get(userId);
  if (!row) {
    row = emptyRawMetrics(userId);
    map.set(userId, row);
  }
  return row;
}

function computeWindowMetrics(
  input: {
    users: readonly User[];
    leads: readonly Lead[];
    deals: readonly Deal[];
    followups: readonly Followup[];
    tasks: readonly LeadTask[];
    outreachThreshold: number;
  },
  start: number,
  end: number,
): RawMetrics[] {
  const { users, leads, deals, followups, outreachThreshold } = input;
  const activeUsers = users.filter((u) => u.status === "active" && u.roleId !== "director");
  const activeIds = new Set(activeUsers.map((u) => u.id));
  const byUser = new Map<string, RawMetrics>();
  for (const u of activeUsers) {
    byUser.set(u.id, emptyRawMetrics(u.id));
  }

  const allOpenDealLeadIds = new Set(
    deals.filter((d) => !["won", "lost"].includes(d.stage)).map((d) => d.leadId),
  );

  for (const l of leads) {
    if (l.intakeKind === "prospect") {
      if (!inWindow(l.createdAt, start, end)) continue;
      // Same ownership surfaces as Prospects (`prospectOwnerIdOf`): creator, scraper,
      // prospect owner, and lead ownerId. Directors stay out via `activeIds`.
      const attrIds = new Set<string>();
      if (l.createdById) attrIds.add(l.createdById);
      if (l.scraperId) attrIds.add(l.scraperId);
      if (l.prospectOwnerId) attrIds.add(l.prospectOwnerId);
      if (l.ownerId) attrIds.add(l.ownerId);
      for (const id of attrIds) {
        if (!activeIds.has(id)) continue;
        const m = ensureMetrics(byUser, id);
        m.prospectsAdded += 1;
        if (typeof l.qualityScore === "number") {
          m.qualityScored += 1;
          m.qualitySum += l.qualityScore;
          m.qualityWeighted += l.qualityScore / 100;
        }
        if ((l.qualityScore ?? 0) >= outreachThreshold) m.qualifiedProspects += 1;
        if (l.strategyId) m.strategyAttributed += 1;
      }
      continue;
    }

    if (!l.ownerId || !activeIds.has(l.ownerId)) continue;
    const m = ensureMetrics(byUser, l.ownerId);

    if (
      isSalesLead(l) &&
      !["won", "lost"].includes(l.stage) &&
      inWindow(l.createdAt, start, end)
    ) {
      m.salesLeadsAdded += 1;
      if ((l.estimatedValue ?? 0) > 0 && !allOpenDealLeadIds.has(l.id)) {
        m.pipelineAdded += l.estimatedValue ?? 0;
      }
    }

    if (inWindow(l.lastReplyAt, start, end)) {
      m.replies += 1;
    }
  }

  for (const f of followups) {
    if (!f.ownerId || !activeIds.has(f.ownerId)) continue;
    const m = ensureMetrics(byUser, f.ownerId);

    if (f.deliveryStatus === "sent" && inWindow(f.sentAt, start, end)) {
      m.emailsSent += 1;
    }

    if (
      (f.deliveryStatus === "sent" && inWindow(f.sentAt, start, end)) ||
      inWindow(f.completedAt, start, end)
    ) {
      m.followupsCompleted += 1;
    }

    if (
      !f.completedAt &&
      !f.pausedAt &&
      (f.deliveryStatus === "scheduled" || Boolean(f.scheduledEmailId))
    ) {
      m.scheduled += 1;
    }

    if (
      !f.completedAt &&
      (f.deliveryStatus === "failed" || f.deliveryStatus === "needs_retry")
    ) {
      m.failed += 1;
    }
  }

  for (const d of deals) {
    if (!d.ownerId || !activeIds.has(d.ownerId)) continue;
    const m = ensureMetrics(byUser, d.ownerId);

    if (!["won", "lost"].includes(d.stage) && inWindow(d.createdAt, start, end)) {
      m.pipelineAdded += d.value;
    }

    if (d.stage === "won" && inWindow(d.updatedAt ?? d.createdAt, start, end)) {
      m.closedValue += d.value;
      m.wonCount += 1;
    }
  }

  return activeUsers.map((u) => byUser.get(u.id) ?? emptyRawMetrics(u.id));
}

/**
 * Per-lens raw score. Quality is baked into lead-gen (unqualified volume earns
 * almost nothing), replies dominate outreach, and closes dominate closing - so
 * ranking rewards effectiveness rather than raw volume.
 */
function lensRawScores(m: RawMetrics): LensRaw {
  const unqualified = Math.max(0, m.prospectsAdded - m.qualifiedProspects);
  return {
    leadgen: m.qualifiedProspects * 2 + unqualified * 0.25 + m.salesLeadsAdded * 3,
    outreach: m.emailsSent + m.replies * 4,
    followups: m.followupsCompleted,
    closing: m.wonCount * 5 + m.closedValue / 1000 + m.pipelineAdded / 4000,
  };
}

function normalizeLens(raws: LensRaw[]): { scores: Record<TeamCommandLens, number>[]; } {
  const lensKeys = Object.keys(OVERALL_WEIGHTS) as Exclude<TeamCommandLens, "overall">[];
  const maxes = {} as Record<Exclude<TeamCommandLens, "overall">, number>;
  for (const key of lensKeys) {
    maxes[key] = raws.reduce((mx, r) => Math.max(mx, r[key]), 0);
  }

  const scores = raws.map((r) => {
    const per = {} as Record<TeamCommandLens, number>;
    for (const key of lensKeys) {
      per[key] = maxes[key] > 0 ? Math.round((r[key] / maxes[key]) * 100) : 0;
    }
    per.overall = Math.round(
      lensKeys.reduce((sum, key) => sum + per[key] * OVERALL_WEIGHTS[key], 0),
    );
    return per;
  });

  return { scores };
}

function buildBottleneck(m: RawMetrics, threshold: number): string | null {
  if (m.prospectsAdded >= 20 && m.emailsSent === 0) {
    return `${m.prospectsAdded} prospects sourced, 0 emails sent`;
  }
  const avg = m.qualityScored > 0 ? m.qualitySum / m.qualityScored : null;
  if (m.prospectsAdded >= 20 && avg !== null && avg < threshold * 0.6) {
    const below = Math.max(0, m.prospectsAdded - m.qualifiedProspects);
    return `High volume, low quality - ${below} prospects below outreach threshold`;
  }
  if (m.emailsSent >= 20 && m.replies === 0) {
    return `${m.emailsSent} sent, 0 replies - messaging not landing`;
  }
  return null;
}

/**
 * Team Command rows: quality-aware per-person performance across lenses, with
 * team-normalized composite scores and period-over-period momentum deltas.
 * Every metric is derived from real records - nothing is manually entered.
 */
export function buildTeamCommandRows(input: {
  users: readonly User[];
  leads: readonly Lead[];
  deals: readonly Deal[];
  followups: readonly Followup[];
  tasks: readonly LeadTask[];
  range: DashboardTimeRangeKey;
  /** Intent Playbook outreach threshold (a prospect at/above this is "qualified"). */
  outreachThreshold: number;
  now?: Date;
  timeZone?: string;
}): TeamCommandRow[] {
  const now = input.now ?? new Date();
  const end = now.getTime();
  const start = getDashboardRangeStart(input.range, {
    now,
    timeZone: input.timeZone,
  }).getTime();
  const allTime = input.range === "all";

  const cur = computeWindowMetrics(input, start, end);
  const curScores = normalizeLens(cur.map(lensRawScores)).scores;

  let prevByUser = new Map<string, Record<TeamCommandLens, number>>();
  if (!allTime) {
    const windowMs = Math.max(1, end - start);
    const prev = computeWindowMetrics(input, start - windowMs, start);
    const prevScores = normalizeLens(prev.map(lensRawScores)).scores;
    prevByUser = new Map(prev.map((m, i) => [m.userId, prevScores[i]]));
  }

  const rows: TeamCommandRow[] = cur.map((m, i) => {
    const scores = curScores[i];
    const prevScore = prevByUser.get(m.userId);
    const deltas = {} as Record<TeamCommandLens, number>;
    for (const lens of TEAM_COMMAND_LENSES) {
      deltas[lens] = allTime ? 0 : scores[lens] - (prevScore?.[lens] ?? 0);
    }
    return {
      userId: m.userId,
      prospectsAdded: m.prospectsAdded,
      qualifiedProspects: m.qualifiedProspects,
      avgQuality: m.qualityScored > 0 ? m.qualitySum / m.qualityScored : null,
      qualityWeighted: m.qualityWeighted,
      strategyAttributed: m.strategyAttributed,
      salesLeadsAdded: m.salesLeadsAdded,
      emailsSent: m.emailsSent,
      replies: m.replies,
      replyRate: m.emailsSent > 0 ? (m.replies / m.emailsSent) * 100 : 0,
      failed: m.failed,
      followupsCompleted: m.followupsCompleted,
      scheduled: m.scheduled,
      pipelineAdded: m.pipelineAdded,
      closedValue: m.closedValue,
      wonCount: m.wonCount,
      scores,
      deltas,
      bottleneck: buildBottleneck(m, input.outreachThreshold),
    };
  });

  return rows.filter(
    (r) =>
      r.prospectsAdded +
        r.salesLeadsAdded +
        r.emailsSent +
        r.replies +
        r.followupsCompleted +
        r.failed >
        0 ||
      r.pipelineAdded > 0 ||
      r.closedValue > 0,
  );
}
