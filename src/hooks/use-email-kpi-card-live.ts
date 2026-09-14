"use client";

import { useQuery } from "@tanstack/react-query";
import type { DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import type { EmailKpiLiveSlice } from "@/lib/dashboard-email-kpi-card";

export type EmailKpiCardApiResponse = {
  ok: boolean;
  range?: string;
  ownerScope?: string;
  composeSentInRange?: number;
  opensInRange?: number;
  error?: string;
};

/**
 * Live compose-send + open-by-sender counts for the Emails pulse card only.
 * Disabled in demo / when the parent opts out.
 */
export function useEmailKpiCardLive(opts: {
  enabled?: boolean;
  range: DashboardTimeRangeKey;
  ownerScope: string;
  timeZone?: string;
}) {
  const enabled = Boolean(opts.enabled);

  const query = useQuery({
    queryKey: [
      "org",
      "email-kpi-card",
      opts.range,
      opts.ownerScope,
      opts.timeZone ?? "",
    ],
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 60_000 : false,
    queryFn: async (): Promise<EmailKpiLiveSlice> => {
      const params = new URLSearchParams({
        range: opts.range,
        ownerScope: opts.ownerScope,
      });
      if (opts.timeZone?.trim()) params.set("timeZone", opts.timeZone.trim());
      const res = await fetch(`/api/org/email-kpi-card?${params.toString()}`);
      const json = (await res.json()) as EmailKpiCardApiResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to load email KPI card");
      }
      return {
        composeSentInRange: Math.max(0, Number(json.composeSentInRange) || 0),
        opensInRange: Math.max(0, Number(json.opensInRange) || 0),
      };
    },
  });

  return {
    live: query.data ?? null,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
