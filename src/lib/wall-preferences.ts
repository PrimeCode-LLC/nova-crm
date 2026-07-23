/** Wall / TV display preferences - stored per browser (same pattern as dashboard prefs). */

export type WallProgressBarPosition = "top" | "bottom";

export type WallSceneKey = "priorities" | "team" | "pipeline";

export type WallScenes = Record<WallSceneKey, boolean>;

export type WallPreferences = {
  /** Seconds each scene stays on screen before advancing. */
  dwellSeconds: number;
  /** Seconds of mouse idle before auto-rotation resumes after pause. */
  resumeIdleSeconds: number;
  /** Show the countdown progress bar. */
  showProgressBar: boolean;
  progressBarPosition: WallProgressBarPosition;
  /** Keep the ops pulse KPI strip visible above scenes. */
  showPulseStrip: boolean;
  /** Which carousel scenes to include. At least one must stay on. */
  scenes: WallScenes;
};

export const WALL_SCENE_META: {
  key: WallSceneKey;
  label: string;
  description: string;
}[] = [
  {
    key: "priorities",
    label: "Priorities",
    description: "Needs attention, action board, and live activity.",
  },
  {
    key: "team",
    label: "Team",
    description: "Team command and inbox utilization.",
  },
  {
    key: "pipeline",
    label: "Pipeline",
    description: "Strategy scoreboard and outreach charts.",
  },
];

export const WALL_DWELL_OPTIONS = [
  { value: 8, label: "8 seconds" },
  { value: 10, label: "10 seconds" },
  { value: 12, label: "12 seconds" },
  { value: 15, label: "15 seconds" },
  { value: 20, label: "20 seconds" },
  { value: 30, label: "30 seconds" },
  { value: 45, label: "45 seconds" },
  { value: 60, label: "60 seconds" },
] as const;

export const WALL_RESUME_IDLE_OPTIONS = [
  { value: 3, label: "3 seconds" },
  { value: 5, label: "5 seconds" },
  { value: 8, label: "8 seconds" },
  { value: 12, label: "12 seconds" },
  { value: 20, label: "20 seconds" },
  { value: 30, label: "30 seconds" },
] as const;

export const DEFAULT_WALL_SCENES: WallScenes = {
  priorities: true,
  team: true,
  pipeline: true,
};

export function defaultWallPreferences(): WallPreferences {
  return {
    dwellSeconds: 15,
    resumeIdleSeconds: 8,
    showProgressBar: true,
    progressBarPosition: "top",
    showPulseStrip: true,
    scenes: { ...DEFAULT_WALL_SCENES },
  };
}

const STORAGE_PREFIX = "nova.wall.prefs.v1";

export function wallPrefsStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId || "anon"}`;
}

/** Shared key for Settings + Wall so both read/write the same prefs. */
export function resolveWallPrefsUserId(
  currentUserId?: string | null,
  demoPersonaId?: string | null,
): string {
  return (currentUserId || demoPersonaId || "anon").trim() || "anon";
}

export const WALL_PREFS_CHANGED_EVENT = "nova-wall-prefs-changed";

export function notifyWallPreferencesChanged(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(WALL_PREFS_CHANGED_EVENT, { detail: { userId: wallPrefsStorageKey(userId) } }),
    );
  } catch {
    /* ignore */
  }
}

function clampDwell(n: number): number {
  const allowed = WALL_DWELL_OPTIONS.map((o) => o.value);
  if (allowed.includes(n as (typeof WALL_DWELL_OPTIONS)[number]["value"])) return n;
  // Snap to nearest allowed option.
  return allowed.reduce((best, v) => (Math.abs(v - n) < Math.abs(best - n) ? v : best), 15);
}

function clampResumeIdle(n: number): number {
  const allowed = WALL_RESUME_IDLE_OPTIONS.map((o) => o.value);
  if (allowed.includes(n as (typeof WALL_RESUME_IDLE_OPTIONS)[number]["value"])) return n;
  return allowed.reduce((best, v) => (Math.abs(v - n) < Math.abs(best - n) ? v : best), 8);
}

export function parseWallPreferences(raw: unknown): WallPreferences {
  const defaults = defaultWallPreferences();
  if (!raw || typeof raw !== "object") return defaults;
  const o = raw as Partial<WallPreferences>;

  const scenes = { ...DEFAULT_WALL_SCENES };
  if (o.scenes && typeof o.scenes === "object") {
    for (const key of Object.keys(DEFAULT_WALL_SCENES) as WallSceneKey[]) {
      const v = (o.scenes as Partial<WallScenes>)[key];
      if (typeof v === "boolean") scenes[key] = v;
    }
  }
  // Keep at least one scene on.
  if (!Object.values(scenes).some(Boolean)) {
    scenes.priorities = true;
  }

  const progressBarPosition: WallProgressBarPosition =
    o.progressBarPosition === "bottom" ? "bottom" : "top";

  return {
    dwellSeconds:
      typeof o.dwellSeconds === "number" && Number.isFinite(o.dwellSeconds)
        ? clampDwell(Math.round(o.dwellSeconds))
        : defaults.dwellSeconds,
    resumeIdleSeconds:
      typeof o.resumeIdleSeconds === "number" && Number.isFinite(o.resumeIdleSeconds)
        ? clampResumeIdle(Math.round(o.resumeIdleSeconds))
        : defaults.resumeIdleSeconds,
    showProgressBar:
      typeof o.showProgressBar === "boolean" ? o.showProgressBar : defaults.showProgressBar,
    progressBarPosition,
    showPulseStrip:
      typeof o.showPulseStrip === "boolean" ? o.showPulseStrip : defaults.showPulseStrip,
    scenes,
  };
}

export function loadWallPreferences(userId: string): WallPreferences {
  if (typeof window === "undefined") return defaultWallPreferences();
  try {
    const raw = localStorage.getItem(wallPrefsStorageKey(userId));
    if (!raw) return defaultWallPreferences();
    return parseWallPreferences(JSON.parse(raw) as unknown);
  } catch {
    return defaultWallPreferences();
  }
}

export function saveWallPreferences(userId: string, prefs: WallPreferences): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(wallPrefsStorageKey(userId), JSON.stringify(prefs));
    notifyWallPreferencesChanged(userId);
  } catch {
    /* ignore quota */
  }
}
