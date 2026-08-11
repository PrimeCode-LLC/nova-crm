/**
 * Phase 2 feature flag: `postgres_read_leads_v1` (P2.10).
 *
 * When **off** (default): workspace leads list stays on Firestore `onSnapshot`.
 * When **on**: clients load leads via `GET /api/org/leads` (Postgres + RLS).
 *
 * Set either env var to `"true"` (same pattern as dashboard summaries).
 * Prefer both in local/staging so server APIs and client shells agree.
 */

export const POSTGRES_READ_LEADS_V1_FLAG = "postgres_read_leads_v1" as const;

/** True when the Phase 2 Postgres leads list read path is enabled. */
export function isPostgresReadLeadsV1Enabled(): boolean {
  return (
    process.env.POSTGRES_READ_LEADS_V1 === "true" ||
    process.env.NEXT_PUBLIC_POSTGRES_READ_LEADS_V1 === "true"
  );
}
