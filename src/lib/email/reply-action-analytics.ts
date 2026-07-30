import {
  REPLY_CLASS_LABELS,
  type ReplyAction,
  type ReplyActionStatus,
  type ReplyClass,
  type ReplyRecommendedAction,
} from "@/lib/email/reply-action-types";

export type ReplyAnalyticsRangeKey = "7d" | "30d" | "90d" | "all" | "custom";

export const REPLY_ANALYTICS_RANGE_LABELS: Record<ReplyAnalyticsRangeKey, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
  custom: "Custom",
};

export type ReplyLeadOutcome = "won" | "lost" | "open" | "unknown";

/** Reply action plus optional lead outcome for win-rate joins. */
export type ReplyActionAnalyticsRow = ReplyAction & {
  leadStage?: string;
  leadOwnerId?: string;
  outcome: ReplyLeadOutcome;
};

export type ReplyAnalyticsKpis = {
  total: number;
  pending: number;
  sent: number;
  accepted: number;
  dismissed: number;
  draftReady: number;
  draftFailed: number;
  draftPending: number;
  avgPotential: number | null;
  /** Hours from createdAt → decidedAt/sentAt when known. */
  avgDecisionHours: number | null;
  sendRate: number | null;
  acceptRate: number | null;
  dismissRate: number | null;
  winRateAmongDecided: number | null;
};

export type NamedCount = { key: string; label: string; count: number };

export type ClassOutcomeRow = {
  classification: ReplyClass;
  label: string;
  total: number;
  sent: number;
  accepted: number;
  dismissed: number;
  pending: number;
  won: number;
  lost: number;
  open: number;
  avgPotential: number | null;
  winRate: number | null;
};

export type OwnerAnalyticsRow = {
  ownerId: string;
  total: number;
  sent: number;
  accepted: number;
  dismissed: number;
  pending: number;
  won: number;
  lost: number;
};

export type DailyPoint = { day: string; count: number; sent: number };

export type ReplyIntelligenceAnalytics = {
  kpis: ReplyAnalyticsKpis;
  byClassification: NamedCount[];
  byStatus: NamedCount[];
  byRecommendedAction: NamedCount[];
  bySource: NamedCount[];
  byDraftStatus: NamedCount[];
  classOutcomes: ClassOutcomeRow[];
  byOwner: OwnerAnalyticsRow[];
  dailyTrend: DailyPoint[];
};

const STATUS_LABELS: Record<ReplyActionStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  dismissed: "Dismissed",
  expired: "Expired",
  sent: "Sent",
};

const ACTION_LABELS: Record<ReplyRecommendedAction, string> = {
  reply_now: "Reply now",
  schedule_followup: "Schedule follow-up",
  book_meeting: "Book meeting",
  nurture: "Nurture",
  close_lost: "Close lost",
  ignore: "Ignore",
  wait: "Wait",
};

function rate(num: number, den: number): number | null {
  if (den <= 0) return null;
  return (num / den) * 100;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function hoursBetween(fromIso: string, toIso: string): number | null {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / 3_600_000;
}

export function outcomeFromLeadStage(stage: string | undefined): ReplyLeadOutcome {
  if (!stage) return "unknown";
  if (stage === "won") return "won";
  if (stage === "lost") return "lost";
  return "open";
}

export function parseReplyAnalyticsRange(
  range: string | null,
  from: string | null,
  to: string | null,
): { key: ReplyAnalyticsRangeKey; fromIso: string; toIso: string } {
  const now = new Date();
  const toIso = to?.trim() || now.toISOString();
  const key = (range as ReplyAnalyticsRangeKey) || "30d";

  if (key === "custom" && from?.trim()) {
    return { key: "custom", fromIso: from.trim(), toIso };
  }
  if (key === "all") {
    return { key: "all", fromIso: new Date(0).toISOString(), toIso };
  }

  const days = key === "7d" ? 7 : key === "90d" ? 90 : 30;
  const fromDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    key: key === "7d" || key === "90d" ? key : "30d",
    fromIso: fromDate.toISOString(),
    toIso,
  };
}

function bump(map: Map<string, number>, key: string, n = 1) {
  map.set(key, (map.get(key) ?? 0) + n);
}

function namedCounts(
  map: Map<string, number>,
  labelFor: (key: string) => string,
): NamedCount[] {
  return [...map.entries()]
    .map(([key, count]) => ({ key, label: labelFor(key), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function aggregateReplyIntelligence(
  rows: readonly ReplyActionAnalyticsRow[],
): ReplyIntelligenceAnalytics {
  const byClass = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const byAction = new Map<string, number>();
  const bySource = new Map<string, number>();
  const byDraft = new Map<string, number>();
  const daily = new Map<string, { count: number; sent: number }>();

  const classBuckets = new Map<
    ReplyClass,
    {
      total: number;
      sent: number;
      accepted: number;
      dismissed: number;
      pending: number;
      won: number;
      lost: number;
      open: number;
      potentials: number[];
    }
  >();

  const ownerBuckets = new Map<
    string,
    {
      total: number;
      sent: number;
      accepted: number;
      dismissed: number;
      pending: number;
      won: number;
      lost: number;
    }
  >();

  const potentials: number[] = [];
  const decisionHours: number[] = [];
  let sent = 0;
  let accepted = 0;
  let dismissed = 0;
  let pending = 0;
  let draftReady = 0;
  let draftFailed = 0;
  let draftPending = 0;
  let decidedWithOutcome = 0;
  let wonAmongDecided = 0;

  for (const row of rows) {
    bump(byClass, row.classification);
    bump(byStatus, row.status);
    bump(byAction, row.recommendedAction);
    bump(bySource, row.source || "system");
    bump(byDraft, row.draftStatus || "none");

    const day = row.createdAt.slice(0, 10);
    const dayPoint = daily.get(day) ?? { count: 0, sent: 0 };
    dayPoint.count += 1;
    if (row.status === "sent") dayPoint.sent += 1;
    daily.set(day, dayPoint);

    if (typeof row.potentialScore === "number" && Number.isFinite(row.potentialScore)) {
      potentials.push(row.potentialScore);
    }

    const decidedAt = row.sentAt || row.decidedAt;
    if (decidedAt) {
      const h = hoursBetween(row.createdAt, decidedAt);
      if (h != null) decisionHours.push(h);
    }

    if (row.status === "sent") sent += 1;
    else if (row.status === "accepted") accepted += 1;
    else if (row.status === "dismissed") dismissed += 1;
    else if (row.status === "pending") pending += 1;

    if (row.draftStatus === "ready") draftReady += 1;
    else if (row.draftStatus === "failed") draftFailed += 1;
    else if (row.draftStatus === "pending") draftPending += 1;

    const classBucket = classBuckets.get(row.classification) ?? {
      total: 0,
      sent: 0,
      accepted: 0,
      dismissed: 0,
      pending: 0,
      won: 0,
      lost: 0,
      open: 0,
      potentials: [],
    };
    classBucket.total += 1;
    if (row.status === "sent") classBucket.sent += 1;
    if (row.status === "accepted") classBucket.accepted += 1;
    if (row.status === "dismissed") classBucket.dismissed += 1;
    if (row.status === "pending") classBucket.pending += 1;
    if (row.outcome === "won") classBucket.won += 1;
    else if (row.outcome === "lost") classBucket.lost += 1;
    else if (row.outcome === "open") classBucket.open += 1;
    if (typeof row.potentialScore === "number") classBucket.potentials.push(row.potentialScore);
    classBuckets.set(row.classification, classBucket);

    const ownerId = row.leadOwnerId || row.decidedBy || row.mailboxOwnerUid || "unknown";
    const ownerBucket = ownerBuckets.get(ownerId) ?? {
      total: 0,
      sent: 0,
      accepted: 0,
      dismissed: 0,
      pending: 0,
      won: 0,
      lost: 0,
    };
    ownerBucket.total += 1;
    if (row.status === "sent") ownerBucket.sent += 1;
    if (row.status === "accepted") ownerBucket.accepted += 1;
    if (row.status === "dismissed") ownerBucket.dismissed += 1;
    if (row.status === "pending") ownerBucket.pending += 1;
    if (row.outcome === "won") ownerBucket.won += 1;
    if (row.outcome === "lost") ownerBucket.lost += 1;
    ownerBuckets.set(ownerId, ownerBucket);

    if (row.status === "sent" || row.status === "accepted") {
      if (row.outcome === "won" || row.outcome === "lost") {
        decidedWithOutcome += 1;
        if (row.outcome === "won") wonAmongDecided += 1;
      }
    }
  }

  const total = rows.length;
  const decided = sent + accepted + dismissed;

  return {
    kpis: {
      total,
      pending,
      sent,
      accepted,
      dismissed,
      draftReady,
      draftFailed,
      draftPending,
      avgPotential: avg(potentials),
      avgDecisionHours: avg(decisionHours),
      sendRate: rate(sent, total),
      acceptRate: rate(accepted, decided),
      dismissRate: rate(dismissed, decided),
      winRateAmongDecided: rate(wonAmongDecided, decidedWithOutcome),
    },
    byClassification: namedCounts(
      byClass,
      (k) => REPLY_CLASS_LABELS[k as ReplyClass] ?? k,
    ),
    byStatus: namedCounts(byStatus, (k) => STATUS_LABELS[k as ReplyActionStatus] ?? k),
    byRecommendedAction: namedCounts(
      byAction,
      (k) => ACTION_LABELS[k as ReplyRecommendedAction] ?? k,
    ),
    bySource: namedCounts(bySource, (k) => k),
    byDraftStatus: namedCounts(byDraft, (k) => k),
    classOutcomes: [...classBuckets.entries()]
      .map(([classification, b]): ClassOutcomeRow => {
        const terminal = b.won + b.lost;
        return {
          classification,
          label: REPLY_CLASS_LABELS[classification],
          total: b.total,
          sent: b.sent,
          accepted: b.accepted,
          dismissed: b.dismissed,
          pending: b.pending,
          won: b.won,
          lost: b.lost,
          open: b.open,
          avgPotential: avg(b.potentials),
          winRate: rate(b.won, terminal),
        };
      })
      .sort((a, b) => b.total - a.total),
    byOwner: [...ownerBuckets.entries()]
      .map(([ownerId, b]): OwnerAnalyticsRow => ({
        ownerId,
        ...b,
      }))
      .sort((a, b) => b.total - a.total),
    dailyTrend: [...daily.entries()]
      .map(([day, v]) => ({ day, count: v.count, sent: v.sent }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
}
