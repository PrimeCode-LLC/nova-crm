import type { FollowupChannelFilter } from "@/lib/followup-plans";

export const FOLLOWUP_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export type FollowupPageSize = (typeof FOLLOWUP_PAGE_SIZE_OPTIONS)[number];

export const FOLLOWUP_DEFAULT_PAGE_SIZE: FollowupPageSize = 10;

const PAGE_SIZE_STORAGE_KEY = "followups-page-size-v2";
const CHANNEL_FILTER_STORAGE_KEY = "followups-channel-filter";

export function isFollowupPageSize(value: number): value is FollowupPageSize {
  return (FOLLOWUP_PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}

export function isFollowupChannelFilter(value: string): value is FollowupChannelFilter {
  return value === "all" || value === "email" || value === "linkedin";
}

export function readFollowupPageSize(): FollowupPageSize {
  if (typeof window === "undefined") return FOLLOWUP_DEFAULT_PAGE_SIZE;
  try {
    const n = Number(window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
    if (isFollowupPageSize(n)) return n;
  } catch {
    /* ignore quota / private mode */
  }
  return FOLLOWUP_DEFAULT_PAGE_SIZE;
}

export function writeFollowupPageSize(pageSize: FollowupPageSize): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(pageSize));
  } catch {
    /* ignore quota / private mode */
  }
}

export function readFollowupChannelFilter(): FollowupChannelFilter {
  if (typeof window === "undefined") return "all";
  try {
    const value = window.localStorage.getItem(CHANNEL_FILTER_STORAGE_KEY);
    if (value && isFollowupChannelFilter(value)) return value;
  } catch {
    /* ignore quota / private mode */
  }
  return "all";
}

export function writeFollowupChannelFilter(filter: FollowupChannelFilter): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHANNEL_FILTER_STORAGE_KEY, filter);
  } catch {
    /* ignore quota / private mode */
  }
}

export type PageNumberItem = number | "ellipsis";

/** 1-based page numbers with ellipsis for compact pagers. */
export function pageNumbersWithEllipsis(current: number, total: number): PageNumberItem[] {
  if (total <= 0) return [];
  const safeTotal = Math.max(1, total);
  const safeCurrent = Math.min(Math.max(1, current), safeTotal);
  if (safeTotal <= 7) {
    return Array.from({ length: safeTotal }, (_, i) => i + 1);
  }

  const pages = new Set<number>([1, safeTotal, safeCurrent]);
  if (safeCurrent > 1) pages.add(safeCurrent - 1);
  if (safeCurrent < safeTotal) pages.add(safeCurrent + 1);

  const sorted = [...pages].sort((a, b) => a - b);
  const items: PageNumberItem[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const page = sorted[i]!;
    const prev = sorted[i - 1];
    if (prev != null && page - prev > 1) items.push("ellipsis");
    items.push(page);
  }
  return items;
}
