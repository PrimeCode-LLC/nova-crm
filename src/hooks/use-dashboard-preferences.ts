"use client";

import * as React from "react";
import {
  DEFAULT_CHANNEL_FUNNELS_VISIBLE,
  DEFAULT_DASHBOARD_WIDGETS,
  defaultDashboardPreferences,
  loadDashboardPreferences,
  saveDashboardPreferences,
  type ChannelFunnelsVisibility,
  type DashboardPreferences,
  type DashboardViewMode,
  type DashboardWidgetKey,
  type DashboardWidgets,
} from "@/lib/dashboard-preferences";
import type { ChannelKey, Role } from "@/lib/types";

export function useDashboardPreferences(userId: string) {
  const [prefs, setPrefs] = React.useState<DashboardPreferences>(() => defaultDashboardPreferences());
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    setPrefs(loadDashboardPreferences(userId));
    setHydrated(true);
  }, [userId]);

  const commit = React.useCallback(
    (next: DashboardPreferences) => {
      setPrefs(next);
      saveDashboardPreferences(userId, next);
    },
    [userId],
  );

  const setViewMode = React.useCallback(
    (viewMode: DashboardViewMode) => {
      commit({ ...prefs, viewMode });
    },
    [commit, prefs],
  );

  const setPreviewRole = React.useCallback(
    (previewRole: Role | null) => {
      commit({ ...prefs, previewRole });
    },
    [commit, prefs],
  );

  const setWidget = React.useCallback(
    (key: DashboardWidgetKey, enabled: boolean) => {
      const widgets: DashboardWidgets = { ...prefs.widgets, [key]: enabled };
      commit({ ...prefs, widgets });
    },
    [commit, prefs],
  );

  const setAllWidgets = React.useCallback(
    (enabled: boolean) => {
      const widgets = { ...DEFAULT_DASHBOARD_WIDGETS };
      for (const key of Object.keys(widgets) as DashboardWidgetKey[]) {
        widgets[key] = enabled;
      }
      commit({ ...prefs, widgets });
    },
    [commit, prefs],
  );

  const setChannelFunnelVisible = React.useCallback(
    (channel: ChannelKey, enabled: boolean) => {
      const channelFunnelsVisible: ChannelFunnelsVisibility = {
        ...prefs.channelFunnelsVisible,
        [channel]: enabled,
      };
      commit({ ...prefs, channelFunnelsVisible });
    },
    [commit, prefs],
  );

  const setAllChannelFunnelsVisible = React.useCallback(
    (enabled: boolean) => {
      const channelFunnelsVisible = { ...DEFAULT_CHANNEL_FUNNELS_VISIBLE };
      for (const key of Object.keys(channelFunnelsVisible) as ChannelKey[]) {
        channelFunnelsVisible[key] = enabled;
      }
      commit({ ...prefs, channelFunnelsVisible });
    },
    [commit, prefs],
  );

  const reset = React.useCallback(() => {
    commit(defaultDashboardPreferences());
  }, [commit]);

  return {
    prefs,
    hydrated,
    setViewMode,
    setPreviewRole,
    setWidget,
    setAllWidgets,
    setChannelFunnelVisible,
    setAllChannelFunnelsVisible,
    reset,
  };
}
