"use client";

import * as React from "react";
import {
  DEFAULT_DASHBOARD_PREFERENCES,
  DEFAULT_DASHBOARD_WIDGETS,
  loadDashboardPreferences,
  saveDashboardPreferences,
  type DashboardPreferences,
  type DashboardViewMode,
  type DashboardWidgetKey,
  type DashboardWidgets,
} from "@/lib/dashboard-preferences";
import type { Role } from "@/lib/types";

export function useDashboardPreferences(userId: string) {
  const [prefs, setPrefs] = React.useState<DashboardPreferences>(() => ({
    ...DEFAULT_DASHBOARD_PREFERENCES,
    widgets: { ...DEFAULT_DASHBOARD_WIDGETS },
  }));
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

  const reset = React.useCallback(() => {
    commit({ ...DEFAULT_DASHBOARD_PREFERENCES, widgets: { ...DEFAULT_DASHBOARD_WIDGETS } });
  }, [commit]);

  return {
    prefs,
    hydrated,
    setViewMode,
    setPreviewRole,
    setWidget,
    setAllWidgets,
    reset,
  };
}
