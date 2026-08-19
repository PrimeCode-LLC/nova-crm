"use client";

import { useQuery } from "@tanstack/react-query";
import { isDashboardSummariesV1Enabled } from "@/lib/dashboard-summary-flags";
import type { ContentOpsOrgGauges, ContentOpsPersonGauges } from "@/lib/content-ops-summary";

type ContentOpsSummaryResponse = {
  ok: boolean;
  enabled: boolean;
  org: ContentOpsOrgGauges | null;
  person: ContentOpsPersonGauges | null;
  source?: "redis" | "documents" | null;
};

/**
 * Precomputed content-ops KPIs when `dashboard_summaries_v1` is on (P0.12).
 */
export function useContentOpsSummary(opts?: { enabled?: boolean }) {
  const flagOn = isDashboardSummariesV1Enabled();
  const enabled = Boolean(opts?.enabled !== false) && flagOn;

  const query = useQuery({
    queryKey: ["org", "content-ops-summary", "v1"],
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 60_000 : false,
    queryFn: async (): Promise<ContentOpsSummaryResponse> => {
      const res = await fetch("/api/org/content-ops-summary");
      const json = (await res.json()) as ContentOpsSummaryResponse;
      if (!res.ok || !json.ok) {
        throw new Error("Failed to load content ops summary");
      }
      return json;
    },
  });

  return {
    flagOn,
    enabled,
    org: query.data?.org ?? null,
    person: query.data?.person ?? null,
    loading: query.isLoading,
  };
}
