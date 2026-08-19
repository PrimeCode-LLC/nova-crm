/** Dual-write removed — Postgres is sole writer (P7). */

export const POSTGRES_DUAL_WRITE_ORGS_V1_FLAG = "postgres_dual_write_orgs_v1";

export function isPostgresDualWriteOrgsEnabled(): boolean {
  return false;
}
