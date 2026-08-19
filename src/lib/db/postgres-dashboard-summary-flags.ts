/** Postgres dashboard summaries always on (P7 — flags removed). */

export const POSTGRES_DASHBOARD_SUMMARY_READ_V1_FLAG =
  "postgres_dashboard_summary_read_v1" as const;
export const POSTGRES_DASHBOARD_SUMMARY_WRITER_V1_FLAG =
  "postgres_dashboard_summary_writer_v1" as const;
export const DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1_FLAG =
  "dashboard_summaries_firestore_writer_v1" as const;

export function isPostgresDashboardSummaryReadV1Enabled(): boolean {
  return true;
}

export function isPostgresDashboardSummaryWriterV1Enabled(): boolean {
  return true;
}

export const isPostgresDashboardSummaryReadEnabled =
  isPostgresDashboardSummaryReadV1Enabled;
export const isPostgresDashboardSummaryWriterEnabled =
  isPostgresDashboardSummaryWriterV1Enabled;

export function isDashboardSummariesV1Enabled(): boolean {
  return false;
}

export function isDashboardSummariesFirestoreWriterV1Enabled(): boolean {
  return false;
}

export const isFirestoreOrgDashboardSummaryWriterEnabled =
  isDashboardSummariesFirestoreWriterV1Enabled;
