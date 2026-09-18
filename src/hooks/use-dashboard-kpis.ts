"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isDashboardKpiApiV2Enabled } from "@/lib/dashboard-kpi-v2-flags";
import type { DashboardKpisPayload } from "@/lib/dashboard-kpis-server";
import type { DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import type { Role } from "@/lib/types";

export type DashboardKpisResponse = {
  ok: boolean;
  enabled: boolean;
  payload: DashboardKpisPayload | null;
  error?: string;
};

export function useDashboardKpis(opts: {
  enabled?: boolean;
  channels?: string[];
  ownerScope?: string;
  range?: DashboardTimeRangeKey | string;
  previewRole?: Role | null;
}) {
  const flagOn = isDashboardKpiApiV2Enabled();
  const enabled = Boolean(opts.enabled) && flagOn;
  const channels = opts.channels ?? [];
  const ownerScope = opts.ownerScope ?? "all-owners";
  const range = opts.range ?? "30d";
  const previewRole = opts.previewRole ?? null;

  const query = useQuery({
    queryKey: [
      "org",
      "dashboard-kpis",
      "v2",
      channels.slice().sort().join(","),
      ownerScope,
      range,
      previewRole ?? "",
    ],
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 60_000 : false,
    queryFn: async (): Promise<DashboardKpisResponse> => {
      const params = new URLSearchParams();
      if (channels.length) params.set("channels", channels.join(","));
      params.set("ownerScope", ownerScope);
      params.set("range", String(range));
      if (previewRole) params.set("previewRole", previewRole);
      const res = await fetch(`/api/org/dashboard-kpis?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const json = (await res.json()) as DashboardKpisResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to load dashboard KPIs");
      }
      return json;
    },
  });

  return {
    flagOn,
    enabled,
    payload: query.data?.payload ?? null,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
}

/** Call after CRM mutations so gauges refresh without waiting for TTL. */
export function useInvalidateDashboardKpis() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["org", "dashboard-kpis", "v2"] });
  };
}
