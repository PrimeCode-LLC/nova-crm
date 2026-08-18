/**
 * Phase 0 feature flag: `dashboard_summaries_v1` (P0.5).
 *
 * P3.4: Postgres is the system of record for org KPI summaries when
 * `POSTGRES_DASHBOARD_SUMMARY_READ_V1` is on. This Phase 0 flag remains as a
 * **rollback** path to read Firestore `orgDashboardSummaries` + Redis.
 *
 * Set either env var to `"true"`. Prefer both in local/staging so server APIs
 * and client shells agree.
 */

export const DASHBOARD_SUMMARIES_V1_FLAG = "dashboard_summaries_v1" as const;

/** True when the Phase 0 Firestore precomputed dashboard summary path is enabled (rollback). */
export function isDashboardSummariesV1Enabled(): boolean {
  return (
    process.env.DASHBOARD_SUMMARIES_V1 === "true" ||
    process.env.NEXT_PUBLIC_DASHBOARD_SUMMARIES_V1 === "true"
  );
}
