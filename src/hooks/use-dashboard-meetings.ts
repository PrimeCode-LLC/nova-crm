"use client";

import * as React from "react";
import type { Meeting } from "@/lib/types";

type MeetingsState = {
  meetings: Meeting[];
  loading: boolean;
  error: string | null;
};

/**
 * Loads meetings for the dashboard action board / wall.
 * Uses the scheduling API (meetings are not on the workspace snapshot).
 * Managers/owners can request org-wide scope.
 */
export function useDashboardMeetings(enabled: boolean, orgScope = false) {
  const [state, setState] = React.useState<MeetingsState>({
    meetings: [],
    loading: false,
    error: null,
  });

  React.useEffect(() => {
    if (!enabled) {
      setState({ meetings: [], loading: false, error: null });
      return;
    }

    let cancelled = false;
    const from = new Date();
    from.setDate(from.getDate() - 1);
    const to = new Date();
    to.setDate(to.getDate() + 45);

    async function load() {
      setState((s) => ({ ...s, loading: s.meetings.length === 0, error: null }));
      try {
        const qs = new URLSearchParams({
          from: from.toISOString(),
          to: to.toISOString(),
        });
        if (orgScope) qs.set("scope", "org");
        const res = await fetch(`/api/scheduling/meetings?${qs}`);
        const json = (await res.json()) as { ok?: boolean; items?: Meeting[]; error?: string };
        if (!res.ok || !json.ok) {
          throw new Error(json.error || "Failed to load meetings");
        }
        if (!cancelled) {
          setState({ meetings: json.items ?? [], loading: false, error: null });
        }
      } catch (e) {
        if (!cancelled) {
          setState((s) => ({
            meetings: s.meetings,
            loading: false,
            error: e instanceof Error ? e.message : "Failed to load meetings",
          }));
        }
      }
    }

    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, orgScope]);

  return state;
}
