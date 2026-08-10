/**
 * Content-ops KPI types + pure compute (P0.12) — safe for client imports.
 */

import { CONTENT_OPEN_STATUSES } from "@/lib/content-calendar/types";

export type ContentOpsOrgGauges = {
  scheduledThisWeek: number;
  publishedThisWeek: number;
  activeBrands: number;
  recentCaptures: number;
  updatedAt: string;
};

export type ContentOpsPersonGauges = {
  myOpenSteps: number;
  updatedAt: string;
};

function startOfLocalDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function endOfLocalWeek(from: Date): number {
  const x = new Date(from);
  const day = x.getDay();
  const daysUntilSun = 7 - day;
  x.setDate(x.getDate() + daysUntilSun);
  x.setHours(23, 59, 59, 999);
  return x.getTime();
}

export function contentOpsOrgCacheKey(organizationId: string): string {
  return `dash:content-ops:v1:${organizationId.trim()}`;
}

export function contentOpsPersonCacheKey(organizationId: string, userId: string): string {
  return `dash:content-ops:v1:${organizationId.trim()}:${userId.trim()}`;
}

export function computeContentOpsOrgGauges(input: {
  items: readonly Record<string, unknown>[];
  brands: readonly Record<string, unknown>[];
  captures: readonly Record<string, unknown>[];
  nowMs?: number;
}): Omit<ContentOpsOrgGauges, "updatedAt"> {
  const now = input.nowMs ?? Date.now();
  const weekStart = startOfLocalDay(new Date(now));
  const weekEnd = endOfLocalWeek(new Date(now));
  let scheduledThisWeek = 0;
  let publishedThisWeek = 0;

  for (const item of input.items) {
    const status = String(item.status ?? "");
    const publishAt = item.publishAt ? new Date(String(item.publishAt)).getTime() : Number.NaN;
    if (
      Number.isFinite(publishAt) &&
      publishAt >= weekStart &&
      publishAt <= weekEnd &&
      (status === "scheduled" || status === "approved")
    ) {
      scheduledThisWeek += 1;
    }
    if (status === "published" && item.completedAt) {
      const done = new Date(String(item.completedAt)).getTime();
      if (Number.isFinite(done) && done >= weekStart && done <= weekEnd) {
        publishedThisWeek += 1;
      }
    }
  }

  const activeBrands = input.brands.filter((b) => b.active !== false).length;
  const recentCaptures = input.captures.filter((c) => {
    const t = new Date(String(c.createdAt ?? "")).getTime();
    return Number.isFinite(t) && now - t < 7 * 86_400_000;
  }).length;

  return { scheduledThisWeek, publishedThisWeek, activeBrands, recentCaptures };
}

export function computeContentOpsPersonGauges(
  items: readonly Record<string, unknown>[],
  userId: string,
): Omit<ContentOpsPersonGauges, "updatedAt"> {
  let myOpenSteps = 0;
  for (const item of items) {
    const status = String(item.status ?? "");
    if (!(CONTENT_OPEN_STATUSES as readonly string[]).includes(status)) continue;
    const checklist = Array.isArray(item.checklist) ? item.checklist : [];
    if (checklist.length === 0) {
      if (item.assigneeUserId === userId || item.ownerUserId === userId) {
        myOpenSteps += 1;
      }
      continue;
    }
    for (const step of checklist) {
      if (
        step &&
        typeof step === "object" &&
        (step as { status?: string }).status === "pending" &&
        (step as { assigneeUserId?: string }).assigneeUserId === userId
      ) {
        myOpenSteps += 1;
      }
    }
  }
  return { myOpenSteps };
}
