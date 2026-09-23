"use client";

import { useQuery } from "@tanstack/react-query";
import { isDashboardSummariesV1Enabled } from "@/lib/dashboard-summary-flags";
import { isPostgresDashboardSummaryReadEnabled } from "@/lib/db/postgres-dashboard-summary-flags";
import type { OrgDashboardSummary } from "@/lib/dashboard-summary";
import type { PersonDashboardTaskGauges } from "@/lib/dashboard-person-summary";
import type { Role } from "@/lib/types";

export type OrgDashboardSummaryResponse = {
  ok: boolean;
  enabled: boolean;
  summary: OrgDashboardSummary | null;
  person?: PersonDashboardTaskGauges | null;
  source: "redis" | "documents" | "postgres" | null;
  personSource?: "redis" | "documents" | null;
  error?: string;
};

/** True when precomputed dashboard summaries (Postgres) are enabled. */
export function isOrgDashboardSummaryClientEnabled(): boolean {
  return isDashboardSummariesV1Enabled() || isPostgresDashboardSummaryReadEnabled();
}

/**
 * Fetches precomputed org dashboard KPIs (+ person task gauges) when a summary
 * read flag is on. Fall back to live aggregation when `summary` is null.
 *
 * Always loads when enabled — person gauges are valid for every role. Callers
 * must only overlay the **org** summary when `canApplyOrgWideDashboardSummary`
 * is true (pass that as `orgWideScope` for callers that still need the flag
 * for scoreboards; it no longer disables this query).
 */
export function useOrgDashboardSummary(opts: {
  enabled?: boolean;
  /** @deprecated No longer gates the fetch; kept for call-site compatibility. */
  orgWideScope?: boolean;
  /** Narrow-only. The server drops a preview that would widen access. */
  previewRole?: Role | null;
}) {
  const flagOn = isOrgDashboardSummaryClientEnabled();
  const enabled = Boolean(opts.enabled) && flagOn;
  const previewRole = opts.previewRole ?? null;

  const query = useQuery({
    queryKey: ["org", "dashboard-summary", "v1", previewRole],
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 60_000 : false,
    queryFn: async (): Promise<OrgDashboardSummaryResponse> => {
      const params = new URLSearchParams();
      if (previewRole) params.set("previewRole", previewRole);
      const qs = params.toString();
      const res = await fetch(qs ? `/api/org/dashboard-summary?${qs}` : "/api/org/dashboard-summary");
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
