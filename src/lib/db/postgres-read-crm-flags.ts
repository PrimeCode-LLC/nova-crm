/** Postgres is always the CRM read source (P7 — flags removed). */

export const POSTGRES_READ_CRM_V1_FLAG = "postgres_read_crm_v1";

export function isPostgresReadCrmV1Enabled(): boolean {
  return true;
}
