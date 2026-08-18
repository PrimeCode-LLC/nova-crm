/**
 * Phase 2 feature flag: `postgres_dual_write_crm_v1` (P2.6–P2.9).
 *
 * When **off** (default): account/contact/lead/deal writes stay Firestore-only.
 * When **on**: successful writes are mirrored into Postgres.
 */

export const POSTGRES_DUAL_WRITE_CRM_V1_FLAG = "postgres_dual_write_crm_v1" as const;

export function isPostgresDualWriteCrmEnabled(): boolean {
  return process.env.POSTGRES_DUAL_WRITE_CRM_V1 === "true";
}
