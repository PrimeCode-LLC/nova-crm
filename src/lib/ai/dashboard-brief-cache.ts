/** Cached dashboard AI briefs are reused for this long before auto-refresh. */
export const DASHBOARD_BRIEF_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export const DASHBOARD_BRIEF_CACHE_DAYS = 3;

/** Max saved brief generations kept per organization (oldest trimmed). */
export const DASHBOARD_BRIEF_HISTORY_MAX = 20;
