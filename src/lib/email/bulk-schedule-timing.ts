import {
  customDueAtFromInputs,
  dueAtForReschedulePreset,
} from "@/lib/followup-due-display";

export type BulkScheduleTimingMode = "auto" | "start_on";

export type BulkScheduleStartPreset = "tomorrow9" | "nextMonday9" | "custom";

const FALLBACK_STEP_GAP_MS = 3 * 24 * 60 * 60 * 1000;

export function resolveBulkScheduleStartIso(input: {
  preset: BulkScheduleStartPreset;
  timeZone: string;
  customDate?: string;
  customTime?: string;
  now?: Date;
}): string {
  if (input.preset === "tomorrow9") {
    return dueAtForReschedulePreset("tomorrow9", input.timeZone, { now: input.now });
  }
  if (input.preset === "nextMonday9") {
    return dueAtForReschedulePreset("nextMonday9", input.timeZone, { now: input.now });
  }
  const date = input.customDate?.trim() ?? "";
  if (!date) return "";
  return customDueAtFromInputs(date, input.customTime?.trim() || "09:00", input.timeZone);
}

export function isBulkScheduleStartInFuture(startIso: string, now = Date.now()): boolean {
  const ms = new Date(startIso).getTime();
  if (Number.isNaN(ms)) return false;
  return ms >= now + 60_000;
}

/**
 * Shift a sequence so the earliest due date lands on `startIso`.
 * Later steps keep the same gaps between original due times.
 */
export function shiftSequenceStepsToStart(
  steps: readonly { id: string; dueAt: string }[],
  startIso: string,
): { id: string; scheduledAt: string; included: true }[] {
  const startMs = new Date(startIso).getTime();
  if (Number.isNaN(startMs)) return [];

  const sorted = [...steps].sort((a, b) => {
    const byDue = a.dueAt.localeCompare(b.dueAt);
    return byDue !== 0 ? byDue : a.id.localeCompare(b.id);
  });
  if (sorted.length === 0) return [];

  const firstDueMs = new Date(sorted[0]!.dueAt).getTime();
  const baseMs = Number.isNaN(firstDueMs) ? startMs : firstDueMs;
  const delta = startMs - baseMs;

  return sorted.map((step, index) => {
    const dueMs = new Date(step.dueAt).getTime();
    const ms = Number.isNaN(dueMs)
      ? startMs + index * FALLBACK_STEP_GAP_MS
      : dueMs + delta;
    return {
      id: step.id,
      scheduledAt: new Date(ms).toISOString(),
      included: true as const,
    };
  });
}
