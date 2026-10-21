import { addDays, addMinutes, endOfDay, isAfter, isBefore, parseISO, startOfDay } from "date-fns";
import type { AvailabilitySchedule, AvailabilityTimeSlot, Meeting } from "@/lib/types";
import { DEFAULT_TIMEZONE, WEEKDAY_KEYS } from "@/lib/scheduling/defaults";
import { resolveOrgTimezone, zonedDayKey, zonedWallTimeToUtc } from "@/lib/org-timezone";

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export type BookableSlot = {
  startAt: string;
  endAt: string;
};

/** The schedule's IANA zone; availability hours are wall-clock times there. */
export function scheduleTimezone(schedule: Pick<AvailabilitySchedule, "timezone">): string {
  return resolveOrgTimezone(schedule.timezone, { fallback: DEFAULT_TIMEZONE });
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD shifted by whole calendar days (zone-independent). */
export function addDaysYmd(ymd: string, days: number): string {
  const m = YMD.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

function weekdayKeyFromYmd(ymd: string): (typeof WEEKDAY_KEYS)[number] | null {
  const m = YMD.exec(ymd);
  if (!m) return null;
  return WEEKDAY_KEYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()]!;
}

function wallTime(ymd: string, hm: string, timeZone: string): Date {
  const [h, m] = hm.split(":").map((x) => Number(x));
  return zonedWallTimeToUtc(ymd, h ?? 0, m ?? 0, 0, 0, timeZone);
}

/**
 * Bookable slots on calendar day `dateYmd` in the schedule's timezone (QA 2.3:
 * previously the server's own zone was used, shifting days and hours).
 */
export function generateSlotsForDate(input: {
  dateYmd: string;
  schedule: AvailabilitySchedule;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  existingMeetings: Pick<Meeting, "startAt" | "endAt" | "status">[];
  now?: Date;
}): BookableSlot[] {
  const now = input.now ?? new Date();
  const dayKey = weekdayKeyFromYmd(input.dateYmd.trim());
  if (!dayKey) return [];
  const blocks: AvailabilityTimeSlot[] = input.schedule.weekly[dayKey] ?? [];
  if (blocks.length === 0) return [];
  const tz = scheduleTimezone(input.schedule);

  const minStart = addMinutes(now, input.schedule.minNoticeHours * 60);
  const slots: BookableSlot[] = [];
  const step = input.durationMin + input.bufferBeforeMin + input.bufferAfterMin;
  if (step <= 0) return [];

  for (const block of blocks) {
    const blockStart = wallTime(input.dateYmd, block.start, tz);
    const blockEnd = wallTime(input.dateYmd, block.end, tz);
    if (Number.isNaN(blockStart.getTime()) || !isBefore(blockStart, blockEnd)) continue;

    let cursor = blockStart;
    while (true) {
      const slotStart = addMinutes(cursor, input.bufferBeforeMin);
      const slotEnd = addMinutes(slotStart, input.durationMin);
      const slotEndBuffered = addMinutes(slotEnd, input.bufferAfterMin);
      if (isAfter(slotEndBuffered, blockEnd)) break;

      const busy = input.existingMeetings.some((m) => {
        if (m.status === "cancelled") return false;
        const mStart = parseISO(m.startAt);
        const mEnd = parseISO(m.endAt);
        return rangesOverlap(slotStart, slotEndBuffered, mStart, mEnd);
      });

      if (!busy && !isBefore(slotStart, minStart)) {
        slots.push({ startAt: slotStart.toISOString(), endAt: slotEnd.toISOString() });
      }

      cursor = addMinutes(cursor, step);
    }
  }

  return slots;
}

/** Calendar days (YYYY-MM-DD, schedule timezone) that have at least one free slot. */
export function datesWithAvailability(input: {
  schedule: AvailabilitySchedule;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  existingMeetings: Pick<Meeting, "startAt" | "endAt" | "status">[];
  now?: Date;
}): string[] {
  const now = input.now ?? new Date();
  const today = zonedDayKey(now, scheduleTimezone(input.schedule));
  const out: string[] = [];

  for (let i = 0; i <= input.schedule.maxDaysAhead; i += 1) {
    const ymd = addDaysYmd(today, i);
    const slots = generateSlotsForDate({
      dateYmd: ymd,
      schedule: input.schedule,
      durationMin: input.durationMin,
      bufferBeforeMin: input.bufferBeforeMin,
      bufferAfterMin: input.bufferAfterMin,
      existingMeetings: input.existingMeetings,
      now,
    });
    if (slots.length > 0) out.push(ymd);
  }

  return out;
}

export function isDateInRange(date: Date, schedule: AvailabilitySchedule, now?: Date): boolean {
  const n = now ?? new Date();
  const max = endOfDay(addDays(startOfDay(n), schedule.maxDaysAhead));
  return !isBefore(date, startOfDay(n)) && !isAfter(date, max);
}
