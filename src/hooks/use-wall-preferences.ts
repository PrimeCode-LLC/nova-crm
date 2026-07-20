"use client";

import * as React from "react";
import {
  defaultWallPreferences,
  loadWallPreferences,
  saveWallPreferences,
  type WallPreferences,
  type WallProgressBarPosition,
  type WallSceneKey,
  type WallScenes,
} from "@/lib/wall-preferences";

export function useWallPreferences(userId: string) {
  const [prefs, setPrefs] = React.useState<WallPreferences>(() => defaultWallPreferences());
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    setPrefs(loadWallPreferences(userId));
    setHydrated(true);
  }, [userId]);

  const commit = React.useCallback(
    (next: WallPreferences) => {
      setPrefs(next);
      saveWallPreferences(userId, next);
    },
    [userId],
  );

  const setDwellSeconds = React.useCallback(
    (dwellSeconds: number) => {
      commit({ ...prefs, dwellSeconds });
    },
    [commit, prefs],
  );

  const setResumeIdleSeconds = React.useCallback(
    (resumeIdleSeconds: number) => {
      commit({ ...prefs, resumeIdleSeconds });
    },
    [commit, prefs],
  );

  const setShowProgressBar = React.useCallback(
    (showProgressBar: boolean) => {
      commit({ ...prefs, showProgressBar });
    },
    [commit, prefs],
  );

  const setProgressBarPosition = React.useCallback(
    (progressBarPosition: WallProgressBarPosition) => {
      commit({ ...prefs, progressBarPosition });
    },
    [commit, prefs],
  );

  const setShowPulseStrip = React.useCallback(
    (showPulseStrip: boolean) => {
      commit({ ...prefs, showPulseStrip });
    },
    [commit, prefs],
  );

  const setScene = React.useCallback(
    (key: WallSceneKey, enabled: boolean) => {
      const scenes: WallScenes = { ...prefs.scenes, [key]: enabled };
      // Never allow turning off the last remaining scene.
      if (!enabled && !Object.values(scenes).some(Boolean)) return;
      commit({ ...prefs, scenes });
    },
    [commit, prefs],
  );

  const reset = React.useCallback(() => {
    commit(defaultWallPreferences());
  }, [commit]);

  return {
    prefs,
    hydrated,
    setDwellSeconds,
    setResumeIdleSeconds,
    setShowProgressBar,
    setProgressBarPosition,
    setShowPulseStrip,
    setScene,
    reset,
  };
}
