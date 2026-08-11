/**
 * Phase 3 — Postgres org dashboard summary flags.
 *
 * **P3.2 writer** — `POSTGRES_DASHBOARD_SUMMARY_WRITER_V1=true`
 *   Lead/deal dual-writes schedule a debounced upsert into `org_dashboard_summaries`.
 *
 * **P3.3 reader** — `POSTGRES_DASHBOARD_SUMMARY_READ_V1=true` (+ `NEXT_PUBLIC_…`)
 *   `GET /api/org/dashboard-summary` reads Postgres (+ Redis). No Firestore fallback (P3.4).
 *
 * **P3.4 Firestore rollback writer** — `DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1=true`
 *   Opt-in only. Default **off**: do not write `orgDashboardSummaries` in Firestore.
 *   Use during emergency rollback alongside Phase 0 `DASHBOARD_SUMMARIES_V1` read.
 */

export const POSTGRES_DASHBOARD_SUMMARY_WRITER_V1_FLAG =
  "postgres_dashboard_summary_writer_v1" as const;

export const POSTGRES_DASHBOARD_SUMMARY_READ_V1_FLAG =
  "postgres_dashboard_summary_read_v1" as const;

export const DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1_FLAG =
  "dashboard_summaries_firestore_writer_v1" as const;

export function isPostgresDashboardSummaryWriterEnabled(): boolean {
  return process.env.POSTGRES_DASHBOARD_SUMMARY_WRITER_V1 === "true";
}

/** True when the Phase 3 Postgres dashboard summary read path is enabled. */
export function isPostgresDashboardSummaryReadEnabled(): boolean {
  return (
    process.env.POSTGRES_DASHBOARD_SUMMARY_READ_V1 === "true" ||
    process.env.NEXT_PUBLIC_POSTGRES_DASHBOARD_SUMMARY_READ_V1 === "true"
  );
}

/**
 * Opt-in Firestore `orgDashboardSummaries` writes (P3.4 rollback).
 * Default off — Postgres is the system of record for these KPIs.
 */
export function isFirestoreOrgDashboardSummaryWriterEnabled(): boolean {
  return process.env.DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1 === "true";
}
