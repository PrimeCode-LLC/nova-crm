import type { ScraperFeed } from "@/lib/types";

export type ScraperRunIntervalUnit = "minutes" | "hours" | "days";

/** Cloud scheduler tick — checks due feeds at this cadence (minimum supported minute interval). */
export const SCRAPER_SCHEDULER_TICK_MINUTES = 15;

const LIMITS: Record<ScraperRunIntervalUnit, { min: number; max: number }> = {
  minutes: { min: 15, max: 1440 },
  hours: { min: 1, max: 168 },
  days: { min: 1, max: 30 },
};

export function runIntervalUnitLabel(unit: ScraperRunIntervalUnit, value: number): string {
  const n = value === 1 ? "" : "s";
  if (unit === "minutes") return `minute${n}`;
  if (unit === "hours") return `hour${n}`;
  return `day${n}`;
}

export function runIntervalToMinutes(value: number, unit: ScraperRunIntervalUnit): number {
  const v = Math.floor(value);
  if (unit === "minutes") return v;
  if (unit === "hours") return v * 60;
  return v * 24 * 60;
}

export function clampRunInterval(value: number, unit: ScraperRunIntervalUnit): number {
  const { min, max } = LIMITS[unit];
  return Math.max(min, Math.min(max, Math.floor(value)));
}

/** Pick a friendly unit when only legacy `runIntervalMinutes` exists. */
export function decomposeRunIntervalMinutes(minutes: number): {
  value: number;
  unit: ScraperRunIntervalUnit;
} {
  const m = Math.max(SCRAPER_SCHEDULER_TICK_MINUTES, Math.floor(minutes));
  if (m % (24 * 60) === 0 && m >= 24 * 60) {
    return { value: m / (24 * 60), unit: "days" };
  }
  if (m % 60 === 0 && m >= 60) {
    return { value: m / 60, unit: "hours" };
  }
  return { value: m, unit: "minutes" };
}

export type NormalizedRunInterval = {
  runIntervalValue: number;
  runIntervalUnit: ScraperRunIntervalUnit;
  runIntervalMinutes: number;
};

export function normalizeRunInterval(input: {
  runIntervalMinutes?: number;
  runIntervalValue?: number;
  runIntervalUnit?: ScraperRunIntervalUnit;
}): NormalizedRunInterval {
  if (
    typeof input.runIntervalValue === "number" &&
    input.runIntervalUnit &&
    LIMITS[input.runIntervalUnit]
  ) {
    const value = clampRunInterval(input.runIntervalValue, input.runIntervalUnit);
    const minutes = runIntervalToMinutes(value, input.runIntervalUnit);
    return {
      runIntervalValue: value,
      runIntervalUnit: input.runIntervalUnit,
      runIntervalMinutes: minutes,
    };
  }

  const legacy =
    typeof input.runIntervalMinutes === "number" && input.runIntervalMinutes > 0
      ? input.runIntervalMinutes
      : 60;
  const decomposed = decomposeRunIntervalMinutes(legacy);
  const value = clampRunInterval(decomposed.value, decomposed.unit);
  return {
    runIntervalValue: value,
    runIntervalUnit: decomposed.unit,
    runIntervalMinutes: runIntervalToMinutes(value, decomposed.unit),
  };
}

export function formatRunInterval(
  feed: Pick<ScraperFeed, "runIntervalValue" | "runIntervalUnit" | "runIntervalMinutes">,
): string {
  const normalized = normalizeRunInterval({
    runIntervalMinutes: feed.runIntervalMinutes,
    runIntervalValue: feed.runIntervalValue,
    runIntervalUnit: feed.runIntervalUnit,
  });
  return `${normalized.runIntervalValue} ${runIntervalUnitLabel(
    normalized.runIntervalUnit,
    normalized.runIntervalValue,
  )}`;
}
