import {
  CONTENT_OPEN_STATUSES,
  isContentItemOverdue,
  type ContentBrand,
  type ContentItem,
  type ContentPillarKey,
} from "@/lib/content-calendar/types";

export type ContentConsistencyScore = {
  weekStart: string;
  weekEnd: string;
  total: number;
  published: number;
  skipped: number;
  open: number;
  overdue: number;
  awaitingApproval: number;
  publishedPercent: number;
  /** @deprecated use verifiedReadyPercent */
  ragBackedPercent: number;
  verifiedReadyPercent: number;
  pillarMix: { key: ContentPillarKey; count: number; percent: number; targetPercent: number }[];
};

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function endOfWeek(start: Date): Date {
  const x = new Date(start);
  x.setDate(x.getDate() + 6);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function computeContentConsistency(input: {
  items: readonly ContentItem[];
  brand?: ContentBrand | null;
  now?: Date;
}): ContentConsistencyScore {
  const now = input.now ?? new Date();
  const weekStart = startOfWeekMonday(now);
  const weekEnd = endOfWeek(weekStart);
  const startMs = weekStart.getTime();
  const endMs = weekEnd.getTime();

  const weekItems = input.items.filter((item) => {
    const t = new Date(item.publishAt).getTime();
    return Number.isFinite(t) && t >= startMs && t <= endMs;
  });

  const published = weekItems.filter((i) => i.status === "published").length;
  const skipped = weekItems.filter((i) => i.status === "skipped").length;
  const open = weekItems.filter((i) => CONTENT_OPEN_STATUSES.includes(i.status)).length;
  const overdue = weekItems.filter((i) => isContentItemOverdue(i, now)).length;
  const awaitingApproval = weekItems.filter(
    (i) => i.status === "review" || i.status === "fact_check" || i.status === "draft",
  ).length;
  const verified = weekItems.filter(
    (i) => i.verifiedFromKnowledge || (i.ragCitations?.length ?? 0) > 0,
  ).length;
  const total = weekItems.length;

  const byPillar = new Map<ContentPillarKey, number>();
  for (const item of weekItems) {
    byPillar.set(item.pillarKey, (byPillar.get(item.pillarKey) ?? 0) + 1);
  }

  const targets = new Map(
    (input.brand?.pillars ?? []).map((p) => [p.key, p.targetPercent] as const),
  );

  const pillarMix = [...byPillar.entries()].map(([key, count]) => ({
    key,
    count,
    percent: total ? Math.round((count / total) * 100) : 0,
    targetPercent: targets.get(key) ?? 0,
  }));

  const publishedPercent = total ? Math.round((published / total) * 100) : 0;
  const verifiedReadyPercent = total ? Math.round((verified / total) * 100) : 0;

  return {
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    total,
    published,
    skipped,
    open,
    overdue,
    awaitingApproval,
    publishedPercent,
    ragBackedPercent: verifiedReadyPercent,
    verifiedReadyPercent,
    pillarMix,
  };
}
