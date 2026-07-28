import { computeContentConsistency } from "@/lib/content-calendar/consistency";
import {
  brandCapturePolicy,
  capturesForBrandInWindow,
  isBehindCaptureCadence,
  isBrandCaptureIdle,
  latestCaptureAtMs,
  type CaptureTimestamp,
} from "@/lib/content-calendar/capture-policy";
import {
  CONTENT_CHECKLIST_STEP_LABELS,
  CONTENT_OPEN_STATUSES,
  CONTENT_STATUS_LABELS,
  isContentItemOverdue,
  resolveBrandResponsibility,
  type ContentBrand,
  type ContentChecklistStepKey,
  type ContentItem,
} from "@/lib/content-calendar/types";

export type ContentWallTone = "default" | "success" | "warn" | "danger";

export type ContentWallBrandCard = {
  brandId: string;
  name: string;
  kind: ContentBrand["kind"];
  planned: number;
  published: number;
  overdue: number;
  scheduled: number;
  open: number;
  captureWeekCount: number;
  captureTarget: number;
  captureIdle: boolean;
  captureBehind: boolean;
  tone: ContentWallTone;
  /** Short status for TV readability. */
  statusLabel: string;
};

export type ContentWallQueueRow = {
  id: string;
  title: string;
  detail: string;
  href: string;
  brandId?: string;
  brandName?: string;
  ownerId?: string;
  dueAt?: string;
  overdue: boolean;
  tone: ContentWallTone;
};

export type ContentWallBoardModel = {
  brands: ContentWallBrandCard[];
  checklist: ContentWallQueueRow[];
  scheduling: ContentWallQueueRow[];
  capture: ContentWallQueueRow[];
};

const MS_DAY = 86_400_000;

function brandNameById(brands: readonly ContentBrand[]): Map<string, string> {
  return new Map(brands.map((b) => [b.id, b.name]));
}

function toneForBrand(card: Omit<ContentWallBrandCard, "tone" | "statusLabel">): {
  tone: ContentWallTone;
  statusLabel: string;
} {
  if (card.overdue > 0) {
    return { tone: "danger", statusLabel: `${card.overdue} overdue` };
  }
  if (card.captureIdle) {
    return { tone: "warn", statusLabel: "Capture idle" };
  }
  if (card.captureBehind) {
    return {
      tone: "warn",
      statusLabel: `Capture ${card.captureWeekCount}/${card.captureTarget}`,
    };
  }
  if (card.planned === 0 && card.open === 0) {
    return { tone: "default", statusLabel: "No posts this week" };
  }
  if (card.published >= card.planned && card.planned > 0) {
    return { tone: "success", statusLabel: "On track" };
  }
  if (card.open > 0) {
    return {
      tone: "default",
      statusLabel: `${card.published}/${card.planned || card.open} published`,
    };
  }
  return {
    tone: "default",
    statusLabel: `${card.published}/${card.planned} published`,
  };
}

export function buildContentWallBrandCards(input: {
  brands: readonly ContentBrand[];
  items: readonly ContentItem[];
  captures: CaptureTimestamp[];
  now?: Date;
}): ContentWallBrandCard[] {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const active = input.brands.filter((b) => b.active);

  return active
    .map((brand) => {
      const brandItems = input.items.filter((i) => i.brandId === brand.id);
      const consistency = computeContentConsistency({
        items: brandItems,
        brand,
        now,
      });
      const scheduled = brandItems.filter(
        (i) =>
          CONTENT_OPEN_STATUSES.includes(i.status) &&
          (i.status === "scheduled" || i.status === "approved"),
      ).length;
      const policy = brandCapturePolicy(brand);
      const captureWeekCount = capturesForBrandInWindow(
        input.captures,
        brand.id,
        nowMs,
      ).length;
      const captureIdle = isBrandCaptureIdle({
        brand,
        captures: input.captures,
        nowMs,
      });
      const captureBehind = isBehindCaptureCadence({
        brand,
        captures: input.captures,
        nowMs,
      });

      const base = {
        brandId: brand.id,
        name: brand.name,
        kind: brand.kind,
        planned: consistency.total,
        published: consistency.published,
        overdue: consistency.overdue,
        scheduled,
        open: consistency.open,
        captureWeekCount,
        captureTarget: policy.capturesPerWeek,
        captureIdle,
        captureBehind,
      };
      const { tone, statusLabel } = toneForBrand(base);
      return { ...base, tone, statusLabel };
    })
    .sort((a, b) => {
      const rank = (c: ContentWallBrandCard) =>
        c.tone === "danger" ? 0 : c.tone === "warn" ? 1 : c.tone === "success" ? 3 : 2;
      const d = rank(a) - rank(b);
      if (d !== 0) return d;
      return a.name.localeCompare(b.name);
    });
}

function dueMs(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : fallback;
}

function isProductionChecklistStep(key: ContentChecklistStepKey): boolean {
  return key === "write" || key === "graphics" || key === "approve";
}

/** Open production checklist steps (write / graphics / approve). */
export function buildContentWallChecklistQueue(input: {
  brands: readonly ContentBrand[];
  items: readonly ContentItem[];
  now?: Date;
  limit?: number;
}): ContentWallQueueRow[] {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const names = brandNameById(input.brands);
  const rows: ContentWallQueueRow[] = [];

  for (const item of input.items) {
    if (!CONTENT_OPEN_STATUSES.includes(item.status)) continue;
    const checklist = item.checklist ?? [];
    if (checklist.length === 0) {
      if (!isContentItemOverdue(item, now)) continue;
      if (item.status === "approved" || item.status === "scheduled") continue;
      rows.push({
        id: `legacy-${item.id}`,
        title: item.title,
        detail: CONTENT_STATUS_LABELS[item.status],
        href: `/content/${item.id}`,
        brandId: item.brandId,
        brandName: names.get(item.brandId),
        ownerId: item.assigneeUserId || item.ownerUserId,
        dueAt: item.dueAt,
        overdue: true,
        tone: "danger",
      });
      continue;
    }

    for (const step of checklist) {
      if (step.status !== "pending") continue;
      if (!isProductionChecklistStep(step.key)) continue;
      const dueRaw = step.dueAt || item.dueAt;
      const due = dueMs(dueRaw, Number.POSITIVE_INFINITY);
      const overdue = due < nowMs;
      rows.push({
        id: `${item.id}-${step.key}`,
        title: item.title,
        detail: CONTENT_CHECKLIST_STEP_LABELS[step.key],
        href: `/content/${item.id}`,
        brandId: item.brandId,
        brandName: names.get(item.brandId),
        ownerId: step.assigneeUserId || item.assigneeUserId || item.ownerUserId,
        dueAt: dueRaw,
        overdue,
        tone: overdue ? "danger" : "default",
      });
    }
  }

  rows.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return dueMs(a.dueAt, Number.POSITIVE_INFINITY) - dueMs(b.dueAt, Number.POSITIVE_INFINITY);
  });

  return input.limit != null ? rows.slice(0, input.limit) : rows;
}

/**
 * Scheduling / publish queue: approved waiting to schedule, scheduled slots,
 * and pending publish checklist steps.
 */
export function buildContentWallSchedulingQueue(input: {
  brands: readonly ContentBrand[];
  items: readonly ContentItem[];
  now?: Date;
  limit?: number;
}): ContentWallQueueRow[] {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const names = brandNameById(input.brands);
  const rows: ContentWallQueueRow[] = [];
  const seen = new Set<string>();

  const push = (row: ContentWallQueueRow) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    rows.push(row);
  };

  for (const item of input.items) {
    if (!CONTENT_OPEN_STATUSES.includes(item.status)) continue;
    const checklist = item.checklist ?? [];
    const publishStep = checklist.find((s) => s.key === "publish" && s.status === "pending");
    const brandName = names.get(item.brandId);

    if (publishStep) {
      const dueRaw = publishStep.dueAt || item.dueAt || item.publishAt;
      const due = dueMs(dueRaw, Number.POSITIVE_INFINITY);
      const overdue = due < nowMs;
      push({
        id: `${item.id}-publish`,
        title: item.title,
        detail: "Publish",
        href: `/content/${item.id}`,
        brandId: item.brandId,
        brandName,
        ownerId:
          publishStep.assigneeUserId || item.assigneeUserId || item.ownerUserId,
        dueAt: dueRaw,
        overdue,
        tone: overdue ? "danger" : "warn",
      });
      continue;
    }

    if (item.status === "approved") {
      const dueRaw = item.dueAt || item.publishAt;
      const due = dueMs(dueRaw, Number.POSITIVE_INFINITY);
      const overdue = due < nowMs;
      push({
        id: `${item.id}-approved`,
        title: item.title,
        detail: "Needs schedule",
        href: `/content/${item.id}`,
        brandId: item.brandId,
        brandName,
        ownerId: item.assigneeUserId || item.ownerUserId,
        dueAt: dueRaw,
        overdue,
        tone: overdue ? "danger" : "warn",
      });
      continue;
    }

    if (item.status === "scheduled") {
      const dueRaw = item.publishAt || item.dueAt;
      const due = dueMs(dueRaw, Number.POSITIVE_INFINITY);
      const overdue = due < nowMs;
      // Show overdue scheduled posts and those publishing within 48h.
      if (!overdue && due - nowMs > 2 * MS_DAY) continue;
      push({
        id: `${item.id}-scheduled`,
        title: item.title,
        detail: overdue ? "Missed publish" : "Publishing soon",
        href: `/content/${item.id}`,
        brandId: item.brandId,
        brandName,
        ownerId: item.assigneeUserId || item.ownerUserId,
        dueAt: dueRaw,
        overdue,
        tone: overdue ? "danger" : "default",
      });
    }
  }

  rows.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return dueMs(a.dueAt, Number.POSITIVE_INFINITY) - dueMs(b.dueAt, Number.POSITIVE_INFINITY);
  });

  return input.limit != null ? rows.slice(0, input.limit) : rows;
}

/** Brands behind capture cadence or idle (team wall view). */
export function buildContentWallCaptureQueue(input: {
  brands: readonly ContentBrand[];
  captures: CaptureTimestamp[];
  now?: Date;
  limit?: number;
}): ContentWallQueueRow[] {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const rows: ContentWallQueueRow[] = [];

  for (const brand of input.brands) {
    if (!brand.active) continue;
    const policy = brandCapturePolicy(brand);
    const weekCount = capturesForBrandInWindow(input.captures, brand.id, nowMs).length;
    const idle = isBrandCaptureIdle({ brand, captures: input.captures, nowMs });
    const behind = isBehindCaptureCadence({ brand, captures: input.captures, nowMs });
    if (!idle && !behind) continue;

    const latestMs = latestCaptureAtMs(input.captures, brand.id);
    const capturer = resolveBrandResponsibility(brand, "capturer");
    const parts: string[] = [];
    if (behind && policy.capturesPerWeek > 0) {
      parts.push(`${weekCount}/${policy.capturesPerWeek} this week`);
    }
    if (idle) {
      parts.push(
        latestMs > 0
          ? `Idle ${Math.floor((nowMs - latestMs) / MS_DAY)}d`
          : "No captures yet",
      );
    }

    rows.push({
      id: `capture-${brand.id}`,
      title: brand.name,
      detail: parts.join(" · ") || "Needs capture",
      href: "/content/capture",
      brandId: brand.id,
      brandName: brand.name,
      ownerId: capturer || brand.ownerUserId,
      overdue: idle,
      tone: idle ? "danger" : "warn",
    });
  }

  rows.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  return input.limit != null ? rows.slice(0, input.limit) : rows;
}

export function buildContentWallBoard(input: {
  brands: readonly ContentBrand[];
  items: readonly ContentItem[];
  captures: CaptureTimestamp[];
  now?: Date;
  queueLimit?: number;
}): ContentWallBoardModel {
  const limit = input.queueLimit ?? 12;
  return {
    brands: buildContentWallBrandCards(input),
    checklist: buildContentWallChecklistQueue({ ...input, limit }),
    scheduling: buildContentWallSchedulingQueue({ ...input, limit }),
    capture: buildContentWallCaptureQueue({ ...input, limit }),
  };
}
