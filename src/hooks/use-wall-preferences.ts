"use client";

import * as React from "react";
import {
  WALL_PREFS_CHANGED_EVENT,
  defaultWallPreferences,
  loadWallPreferences,
  saveWallPreferences,
  wallPrefsStorageKey,
  type WallPreferences,
  type WallProgressBarPosition,
  type WallSceneKey,
  type WallScenes,
} from "@/lib/wall-preferences";

export function useWallPreferences(userId: string) {
  const [prefs, setPrefs] = React.useState<WallPreferences>(() => defaultWallPreferences());
  const [hydrated, setHydrated] = React.useState(false);
  const prefsRef = React.useRef(prefs);
  prefsRef.current = prefs;

  const reload = React.useCallback(() => {
    setPrefs(loadWallPreferences(userId));
    setHydrated(true);
  }, [userId]);

  React.useEffect(() => {
    reload();
  }, [reload]);

  // Pick up changes from Settings (same tab via custom event, other tabs via storage).
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const key = wallPrefsStorageKey(userId);

    const onStorage = (e: StorageEvent) => {
      if (e.key === key) reload();
    };
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<{ userId?: string }>).detail;
      if (!detail?.userId || detail.userId === key) reload();
    };
    const onFocus = () => reload();
    const onVisibility = () => {
      if (document.visibilityState === "visible") reload();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(WALL_PREFS_CHANGED_EVENT, onCustom);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(WALL_PREFS_CHANGED_EVENT, onCustom);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId, reload]);

  const commit = React.useCallback(
    (next: WallPreferences) => {
      setPrefs(next);
      saveWallPreferences(userId, next);
    },
    [userId],
  );

  const patch = React.useCallback(
    (partial: Partial<WallPreferences>) => {
      commit({ ...prefsRef.current, ...partial });
    },
    [commit],
  );

  const setDwellSeconds = React.useCallback(
    (dwellSeconds: number) => {
      patch({ dwellSeconds });
    },
    [patch],
  );

  const setResumeIdleSeconds = React.useCallback(
    (resumeIdleSeconds: number) => {
      patch({ resumeIdleSeconds });
    },
    [patch],
  );

  const setShowProgressBar = React.useCallback(
    (showProgressBar: boolean) => {
      patch({ showProgressBar });
    },
    [patch],
  );

  const setProgressBarPosition = React.useCallback(
    (progressBarPosition: WallProgressBarPosition) => {
      patch({ progressBarPosition });
    },
    [patch],
  );

  const setShowPulseStrip = React.useCallback(
    (showPulseStrip: boolean) => {
      patch({ showPulseStrip });
    },
    [patch],
  );

  const setScene = React.useCallback(
    (key: WallSceneKey, enabled: boolean) => {
      const scenes: WallScenes = { ...prefsRef.current.scenes, [key]: enabled };
      // Never allow turning off the last remaining scene.
      if (!enabled && !Object.values(scenes).some(Boolean)) return;
      patch({ scenes });
    },
    [patch],
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
