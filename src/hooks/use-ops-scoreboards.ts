"use client";

import { useQuery } from "@tanstack/react-query";
import { isDashboardSummariesV1Enabled } from "@/lib/dashboard-summary-flags";
import type { DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import type { OpsScoreboardsPayload } from "@/lib/ops-scoreboards";

type OpsScoreboardsResponse = {
  ok: boolean;
  enabled: boolean;
  payload: OpsScoreboardsPayload | null;
  source?: "redis" | "documents" | null;
};

/**
 * Precomputed ops scoreboard rows when `dashboard_summaries_v1` is on (P0.13).
 * Pass `orgWideScope: false` when channel/owner filters are active.
 */
export function useOpsScoreboards(opts: {
  range: DashboardTimeRangeKey;
  enabled?: boolean;
  orgWideScope?: boolean;
}) {
  const flagOn = isDashboardSummariesV1Enabled();
  const enabled =
    Boolean(opts.enabled !== false) && flagOn && opts.orgWideScope !== false;

  const query = useQuery({
    queryKey: ["org", "ops-scoreboards", "v1", opts.range],
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 60_000 : false,
    queryFn: async (): Promise<OpsScoreboardsResponse> => {
      const res = await fetch(
        `/api/org/ops-scoreboards?range=${encodeURIComponent(opts.range)}`,
      );
      const json = (await res.json()) as OpsScoreboardsResponse;
      if (!res.ok || !json.ok) {
        throw new Error("Failed to load ops scoreboards");
      }
      return json;
    },
  });

  return {
    flagOn,
    enabled,
    payload: query.data?.payload ?? null,
    source: query.data?.source ?? null,
    loading: query.isLoading,
  };
}
