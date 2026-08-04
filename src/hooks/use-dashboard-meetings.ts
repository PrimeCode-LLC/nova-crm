"use client";

import { useQuery } from "@tanstack/react-query";
import type { Meeting } from "@/lib/types";

/**
 * Loads meetings for the dashboard action board / wall.
 * Uses the scheduling API (meetings are not on the workspace snapshot).
 * Managers/owners can request org-wide scope.
 */
export function useDashboardMeetings(enabled: boolean, orgScope = false) {
  const query = useQuery({
    queryKey: ["scheduling", "meetings", "dashboard", orgScope ? "org" : "mine"],
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 60_000 : false,
    queryFn: async (): Promise<Meeting[]> => {
      const from = new Date();
      from.setDate(from.getDate() - 1);
      const to = new Date();
      to.setDate(to.getDate() + 45);
      const qs = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
      });
      if (orgScope) qs.set("scope", "org");
      const res = await fetch(`/api/scheduling/meetings?${qs}`);
      const json = (await res.json()) as {
        ok?: boolean;
        items?: Meeting[];
        error?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to load meetings");
      }
      return json.items ?? [];
    },
  });

  return {
    meetings: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
