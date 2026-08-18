/**
 * Phase 6 feature flag: `postgres_sole_writer_crm_v1` (P6.2).
 *
 * When **off** (default): CRM writes stay Firestore-first (+ dual-write mirror if enabled).
 * When **on**: client/server CRM writes go to Postgres only (no Firestore write for that entity).
 *
 * Prefer both env vars so server APIs and client persist helpers agree.
 * Requires `POSTGRES_READ_CRM_V1` / leads read flags on in the same env before enabling.
 */

export const POSTGRES_SOLE_WRITER_CRM_V1_FLAG = "postgres_sole_writer_crm_v1" as const;

/** True when Postgres is the sole writer for accounts/contacts/leads/deals. */
export function isPostgresSoleWriterCrmV1Enabled(): boolean {
  return (
    process.env.POSTGRES_SOLE_WRITER_CRM_V1 === "true" ||
    process.env.NEXT_PUBLIC_POSTGRES_SOLE_WRITER_CRM_V1 === "true"
  );
}
