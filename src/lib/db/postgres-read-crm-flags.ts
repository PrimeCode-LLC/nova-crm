/**
 * Phase 6 feature flag: `postgres_read_crm_v1` (P6.1).
 *
 * When **off** (default): workspace accounts/contacts/deals stay on Firestore `onSnapshot`.
 * When **on**: clients load those entities via `/api/org/{accounts|contacts|deals}` (Postgres + RLS).
 *
 * Set either env var to `"true"` (same pattern as leads / dashboard summaries).
 * Prefer both in local/staging so server APIs and client shells agree.
 */

export const POSTGRES_READ_CRM_V1_FLAG = "postgres_read_crm_v1" as const;

/** True when the Phase 6 Postgres CRM directory/deals read path is enabled. */
export function isPostgresReadCrmV1Enabled(): boolean {
  return (
    process.env.POSTGRES_READ_CRM_V1 === "true" ||
    process.env.NEXT_PUBLIC_POSTGRES_READ_CRM_V1 === "true"
  );
}
