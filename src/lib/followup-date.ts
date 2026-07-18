/** Relative business-day gaps between consecutive sequence steps (Sat/Sun skipped). */
export const SEQUENCE_BUSINESS_DAY_GAPS = [0, 3, 5, 7] as const;

function formatDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** Add N business days (Mon–Fri only). N=0 returns the same calendar day. */
export function addBusinessDays(from: Date, businessDays: number): Date {
  const d = startOfLocalDay(from);
  if (businessDays === 0) return d;

  const step = businessDays > 0 ? 1 : -1;
  let remaining = Math.abs(businessDays);
  while (remaining > 0) {
    d.setDate(d.getDate() + step);
    if (!isWeekend(d)) remaining -= 1;
  }
  return d;
}

export function isoFromDateInput(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function todayDateInputValue(): string {
  return formatDateInput(new Date());
}

/** Calendar-day offset (legacy). Prefer business-day helpers for sequences. */
export function dateInputFromOffsetDays(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return formatDateInput(d);
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
  options?: { includeInitial?: boolean; from?: Date },
): string {
  const includeInitial = options?.includeInitial ?? true;
  let d = startOfLocalDay(options?.from ?? new Date());
  for (let i = 0; i <= stepIndex; i++) {
    d = addBusinessDays(d, sequenceStepBusinessDayGap(i, includeInitial));
  }
  return formatDateInput(d);
}
