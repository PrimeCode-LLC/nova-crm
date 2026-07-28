import {
  getBrowserTimezone,
  isoFromDateInputInZone,
  resolveOrgTimezone,
  todayDateInputInZone,
  zonedDayKey,
} from "@/lib/org-timezone";

/** Relative business-day gaps between consecutive sequence steps (Sat/Sun skipped). */
export const SEQUENCE_BUSINESS_DAY_GAPS = [0, 3, 5, 7] as const;

function formatDateInput(d: Date, timeZone?: string): string {
  const zone = resolveOrgTimezone(timeZone);
  return zonedDayKey(d, zone);
}

function startOfCalendarDay(d: Date, timeZone?: string): Date {
  const zone = resolveOrgTimezone(timeZone);
  const key = zonedDayKey(d, zone);
  // Use a Date at local interpretation of the ymd for business-day arithmetic
  // (day-of-week stepping). Wall-clock storage still goes through isoFromDateInput.
  const [y, m, day] = key.split("-").map(Number);
  return new Date(y!, m! - 1, day!);
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** Add N business days (Mon–Fri only). N=0 returns the same calendar day. */
export function addBusinessDays(from: Date, businessDays: number): Date {
  const d = startOfCalendarDay(from);
  if (businessDays === 0) return d;

  const step = businessDays > 0 ? 1 : -1;
  let remaining = Math.abs(businessDays);
  while (remaining > 0) {
    d.setDate(d.getDate() + step);
    if (!isWeekend(d)) remaining -= 1;
  }
  return d;
}

/**
 * Noon in the given (or browser) timezone for a YYYY-MM-DD date input.
 * Prefer passing the org timezone so due dates align across the team.
 */
export function isoFromDateInput(dateStr: string, timeZone?: string): string {
  const zone = resolveOrgTimezone(timeZone);
  return isoFromDateInputInZone(dateStr, zone);
}

export function todayDateInputValue(timeZone?: string): string {
  const zone = resolveOrgTimezone(timeZone);
  return todayDateInputInZone(zone);
}

/** Calendar-day offset (legacy). Prefer business-day helpers for sequences. */
export function dateInputFromOffsetDays(offsetDays: number, timeZone?: string): string {
  const zone = resolveOrgTimezone(timeZone);
  const d = startOfCalendarDay(new Date(), zone);
  d.setDate(d.getDate() + offsetDays);
  return formatDateInput(d, zone);
}

/**
 * Business-day gap from the previous step for a sequence index.
 * Full: Initial=0, FU1=+3, FU2=+5, FU3=+7 (then +7).
 * Continue (no initial): first remaining uses +3, then +5, +7…
 */
export function sequenceStepBusinessDayGap(
  stepIndex: number,
  includeInitial = true,
): number {
  const gaps = includeInitial
    ? SEQUENCE_BUSINESS_DAY_GAPS
    : SEQUENCE_BUSINESS_DAY_GAPS.slice(1);
  if (stepIndex < 0) return 0;
  if (stepIndex < gaps.length) return gaps[stepIndex]!;
  return 7;
}

/**
 * Due date (YYYY-MM-DD) for a sequence step using the prospect follow-up cadence:
 * Initial Day 0 → FU1 +3 BD → FU2 +5 BD after FU1 → FU3 +7 BD after FU2.
 */
export function dateInputForSequenceStep(
  stepIndex: number,
  options?: { includeInitial?: boolean; from?: Date; timeZone?: string },
): string {
  const includeInitial = options?.includeInitial ?? true;
  const zone = resolveOrgTimezone(options?.timeZone);
  let d = startOfCalendarDay(options?.from ?? new Date(), zone);
  for (let i = 0; i <= stepIndex; i++) {
    d = addBusinessDays(d, sequenceStepBusinessDayGap(i, includeInitial));
  }
  return formatDateInput(d, zone);
}

export { getBrowserTimezone };
