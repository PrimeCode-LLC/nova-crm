"use client";

import { useQuery } from "@tanstack/react-query";
import { isDashboardSummariesV1Enabled } from "@/lib/dashboard-summary-flags";
import { isPostgresDashboardSummaryReadEnabled } from "@/lib/db/postgres-dashboard-summary-flags";
import type { OrgDashboardSummary } from "@/lib/dashboard-summary";
import type { PersonDashboardTaskGauges } from "@/lib/dashboard-person-summary";

export type OrgDashboardSummaryResponse = {
  ok: boolean;
  enabled: boolean;
  summary: OrgDashboardSummary | null;
  person?: PersonDashboardTaskGauges | null;
  source: "redis" | "firestore" | "postgres" | null;
  personSource?: "redis" | "firestore" | null;
  error?: string;
};

/** True when either Phase 0 Firestore summaries or Phase 3 Postgres read is enabled. */
export function isOrgDashboardSummaryClientEnabled(): boolean {
  return isDashboardSummariesV1Enabled() || isPostgresDashboardSummaryReadEnabled();
}

/**
 * Fetches precomputed org dashboard KPIs (+ person task gauges) when a summary
 * read flag is on. Fall back to live aggregation when `summary` is null.
 */
export function useOrgDashboardSummary(opts: {
  enabled?: boolean;
  /** Org-wide summary only — disable when channel/owner filters are active. */
  orgWideScope?: boolean;
}) {
  const flagOn = isOrgDashboardSummaryClientEnabled();
  const enabled = Boolean(opts.enabled) && flagOn && opts.orgWideScope !== false;

  const query = useQuery({
    queryKey: ["org", "dashboard-summary", "v1"],
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 60_000 : false,
    queryFn: async (): Promise<OrgDashboardSummaryResponse> => {
      const res = await fetch("/api/org/dashboard-summary");
      const json = (await res.json()) as OrgDashboardSummaryResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to load dashboard summary");
      }
      return json;
    },
  });

  return {
    flagOn,
    enabled,
    summary: query.data?.summary ?? null,
    person: query.data?.person ?? null,
    source: query.data?.source ?? null,
    personSource: query.data?.personSource ?? null,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
