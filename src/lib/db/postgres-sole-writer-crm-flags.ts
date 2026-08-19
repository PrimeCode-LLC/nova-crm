/** Postgres is always the CRM sole writer (P7 — flags removed). */

export const POSTGRES_SOLE_WRITER_CRM_V1_FLAG = "postgres_sole_writer_crm_v1" as const;

export function isPostgresSoleWriterCrmV1Enabled(): boolean {
  return true;
}
