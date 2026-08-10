/**
 * Phase 0 feature flag: `dashboard_summaries_v1` (P0.5).
 *
 * When **off** (default): dashboard KPIs keep the live client aggregation path.
 * When **on**: readers may use `orgDashboardSummaries` + Redis (wired in P0.6+).
 *
 * Set either env var to `"true"` (same pattern as auth disable flags).
 * Prefer both in local/staging so server APIs and client shells agree.
 */

export const DASHBOARD_SUMMARIES_V1_FLAG = "dashboard_summaries_v1" as const;

/** True when the Phase 0 precomputed dashboard summary path is enabled. */
export function isDashboardSummariesV1Enabled(): boolean {
  return (
    process.env.DASHBOARD_SUMMARIES_V1 === "true" ||
    process.env.NEXT_PUBLIC_DASHBOARD_SUMMARIES_V1 === "true"
  );
}
