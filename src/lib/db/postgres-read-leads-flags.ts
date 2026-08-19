/** Postgres is always the leads read source (P7 — flags removed). */

export const POSTGRES_READ_LEADS_V1_FLAG = "postgres_read_leads_v1";

export function isPostgresReadLeadsV1Enabled(): boolean {
  return true;
}
