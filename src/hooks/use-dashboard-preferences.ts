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
    (updater: DashboardPreferences | ((prev: DashboardPreferences) => DashboardPreferences)) => {
      setPrefs((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        saveDashboardPreferences(userId, next);
        return next;
      });
    },
    [userId],
  );

  const setViewMode = React.useCallback(
    (viewMode: DashboardViewMode) => {
      commit((prev) => ({ ...prev, viewMode }));
    },
    [commit],
  );

  const setPreviewRole = React.useCallback(
    (previewRole: Role | null) => {
      commit((prev) => ({ ...prev, previewRole }));
    },
    [commit],
  );

  /** Clears role preview and restores Auto layout in one write (avoids stale overwrites). */
  const exitPreview = React.useCallback(() => {
    commit((prev) => ({ ...prev, previewRole: null, viewMode: "auto" }));
  }, [commit]);

  const setWidget = React.useCallback(
    (key: DashboardWidgetKey, enabled: boolean) => {
      commit((prev) => ({
        ...prev,
        widgets: { ...prev.widgets, [key]: enabled },
      }));
    },
    [commit],
  );

  const setAllWidgets = React.useCallback(
    (enabled: boolean) => {
      const widgets = { ...DEFAULT_DASHBOARD_WIDGETS };
      for (const key of Object.keys(widgets) as DashboardWidgetKey[]) {
        widgets[key] = enabled;
      }
      commit((prev) => ({ ...prev, widgets }));
    },
    [commit],
  );

  const setChannelFunnelVisible = React.useCallback(
    (channel: ChannelKey, enabled: boolean) => {
      commit((prev) => ({
        ...prev,
        channelFunnelsVisible: {
          ...prev.channelFunnelsVisible,
          [channel]: enabled,
        },
      }));
    },
    [commit],
  );

  const setAllChannelFunnelsVisible = React.useCallback(
    (enabled: boolean) => {
      const channelFunnelsVisible = { ...DEFAULT_CHANNEL_FUNNELS_VISIBLE };
      for (const key of Object.keys(channelFunnelsVisible) as ChannelKey[]) {
        channelFunnelsVisible[key] = enabled;
      }
      commit((prev) => ({ ...prev, channelFunnelsVisible }));
    },
    [commit],
  );

  const setStrategyScoreboardVisible = React.useCallback(
    (strategyId: string, enabled: boolean) => {
      commit((prev) => ({
        ...prev,
        strategyScoreboardVisible: {
          ...prev.strategyScoreboardVisible,
          [strategyId]: enabled,
        },
      }));
    },
    [commit],
  );

  const setAllStrategyScoreboardVisible = React.useCallback(
    (strategyIds: string[], enabled: boolean) => {
      commit((prev) => {
        const strategyScoreboardVisible = { ...prev.strategyScoreboardVisible };
        for (const id of strategyIds) {
          strategyScoreboardVisible[id] = enabled;
        }
        return { ...prev, strategyScoreboardVisible };
      });
    },
    [commit],
  );

  const reset = React.useCallback(() => {
    commit(defaultDashboardPreferences());
  }, [commit]);

  return {
    prefs,
    hydrated,
    setViewMode,
    setPreviewRole,
    exitPreview,
    setWidget,
    setAllWidgets,
    setChannelFunnelVisible,
    setAllChannelFunnelsVisible,
    setStrategyScoreboardVisible,
    setAllStrategyScoreboardVisible,
    reset,
  };
}
