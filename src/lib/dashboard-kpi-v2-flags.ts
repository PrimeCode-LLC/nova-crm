/**
 * Phase 2+ feature flags for backend KPI aggregates and workspace poll cutover.
 * Default OFF — production keeps the previous live/poll behavior until explicitly enabled.
 */

export const DASHBOARD_KPI_API_V2_FLAG = "dashboard_kpi_api_v2" as const;
export const DASHBOARD_KPI_SQL_AGGREGATES_FLAG = "dashboard_kpi_sql_aggregates" as const;
export const WORKSPACE_CRM_POLL_V2_FLAG = "workspace_crm_poll_v2" as const;

/** Client + server: read KPIs from GET /api/org/dashboard-kpis (aggregates only). */
export function isDashboardKpiApiV2Enabled(): boolean {
  return (
    process.env.DASHBOARD_KPI_API_V2 === "true" ||
    process.env.NEXT_PUBLIC_DASHBOARD_KPI_API_V2 === "true"
  );
}

/** SQL aggregate path for scoped KPIs + org summary writer (default off). */
export function isDashboardKpiSqlAggregatesEnabled(): boolean {
  return process.env.DASHBOARD_KPI_SQL_AGGREGATES === "true";
}

/**
 * Raise the CRM poll to ≥60s and serve list pages from cursor pagination.
 *
 * Deliberately does **not** disable the `all=1` base snapshot yet: `ws.leads` is
 * still the only source for reply automation, timeline owner resolution, kanban,
 * and session staging. Removing it is gated on closing those consumers first
 * (plan Phase 5, register B), otherwise flag-on silently breaks them.
 */
export function isWorkspaceCrmPollV2Enabled(): boolean {
  return (
    process.env.WORKSPACE_CRM_POLL_V2 === "true" ||
    process.env.NEXT_PUBLIC_WORKSPACE_CRM_POLL_V2 === "true"
  );
}

/** Server totals for list pages: GET `/api/org/crm-counts` (tenant + role-derived narrow). */
export const CRM_COUNTS_API_PATH = "/api/org/crm-counts" as const;
