import type { ActivityCounterRow } from "./types";

const STORAGE_KEY = "nova-crm-local-activity-rollups-v1";

function rollupKey(r: ActivityCounterRow): string {
  return `${r.userId}|${r.date.slice(0, 10)}|${r.channel}|${r.profileId ?? ""}`;
}

export function readLocalActivityRollups(): ActivityCounterRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as ActivityCounterRow[];
  } catch {
    return [];
  }
}

export function upsertLocalActivityRollup(row: ActivityCounterRow): void {
  const existing = readLocalActivityRollups();
  const next = existing.filter((r) => rollupKey(r) !== rollupKey(row));
  next.push(row);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

/** Prefer locally saved rows over mock/server rows for the same day, channel, user, and profile. */
export function mergeActivityCounters(
  base: readonly ActivityCounterRow[],
  local: readonly ActivityCounterRow[],
): ActivityCounterRow[] {
  const keys = new Set(local.map(rollupKey));
  const filtered = base.filter((r) => !keys.has(rollupKey(r)));
  return [...filtered, ...local];
}
