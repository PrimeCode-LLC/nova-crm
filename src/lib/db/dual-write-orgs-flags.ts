/**
 * Phase 2 feature flag: `postgres_dual_write_orgs_v1` (P2.3).
 *
 * When **off** (default): org/member writes stay Firestore-only.
 * When **on**: after a successful Firestore write, mirror create/update into Postgres.
 *
 * Set `POSTGRES_DUAL_WRITE_ORGS_V1=true`. Requires `DATABASE_URL` (nova_app).
 */

export const POSTGRES_DUAL_WRITE_ORGS_V1_FLAG = "postgres_dual_write_orgs_v1" as const;

export function isPostgresDualWriteOrgsEnabled(): boolean {
  return process.env.POSTGRES_DUAL_WRITE_ORGS_V1 === "true";
}
