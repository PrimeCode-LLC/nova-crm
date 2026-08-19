/** Dual-write removed — Postgres is sole writer (P7). */

export const POSTGRES_DUAL_WRITE_CRM_V1_FLAG = "postgres_dual_write_crm_v1";

export function isPostgresDualWriteCrmEnabled(): boolean {
  return false;
}

export function isPostgresDualWriteOrgsEnabled(): boolean {
  return false;
}
