import {
  addDays,
  addMinutes,
  endOfDay,
  isAfter,
  isBefore,
  parseISO,
  setHours,
  setMinutes,
  startOfDay,
} from "date-fns";
import type { AvailabilitySchedule, AvailabilityTimeSlot, Meeting } from "@/lib/types";
import { weekdayKeyFromDate } from "@/lib/scheduling/defaults";

function parseHm(hm: string, base: Date): Date {
  const [h, m] = hm.split(":").map((x) => Number(x));
  return setMinutes(setHours(base, h ?? 0), m ?? 0);
}

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export type BookableSlot = {
  startAt: string;
  endAt: string;
};

export function generateSlotsForDate(input: {
  date: Date;
  schedule: AvailabilitySchedule;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  existingMeetings: Pick<Meeting, "startAt" | "endAt" | "status">[];
  now?: Date;
}): BookableSlot[] {
  const now = input.now ?? new Date();
  const dayStart = startOfDay(input.date);
  const dayKey = weekdayKeyFromDate(input.date);
  const blocks: AvailabilityTimeSlot[] = input.schedule.weekly[dayKey] ?? [];
  if (blocks.length === 0) return [];

  const minStart = addMinutes(now, input.schedule.minNoticeHours * 60);
  const slots: BookableSlot[] = [];
  const step = input.durationMin + input.bufferBeforeMin + input.bufferAfterMin;

  for (const block of blocks) {
    const blockStart = parseHm(block.start, dayStart);
    const blockEnd = parseHm(block.end, dayStart);
    if (!isBefore(blockStart, blockEnd)) continue;

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

export function datesWithAvailability(input: {
  schedule: AvailabilitySchedule;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  existingMeetings: Pick<Meeting, "startAt" | "endAt" | "status">[];
  fromDate?: Date;
  now?: Date;
}): string[] {
  const now = input.now ?? new Date();
  const from = startOfDay(input.fromDate ?? now);
  const maxDate = addDays(from, input.schedule.maxDaysAhead);
  const out: string[] = [];

  for (let d = from; !isAfter(d, maxDate); d = addDays(d, 1)) {
    const slots = generateSlotsForDate({
      date: d,
      schedule: input.schedule,
      durationMin: input.durationMin,
      bufferBeforeMin: input.bufferBeforeMin,
      bufferAfterMin: input.bufferAfterMin,
      existingMeetings: input.existingMeetings,
      now,
    });
    if (slots.length > 0) {
      out.push(startOfDay(d).toISOString().slice(0, 10));
    }
  }

  return out;
}

export function isDateInRange(date: Date, schedule: AvailabilitySchedule, now?: Date): boolean {
  const n = now ?? new Date();
  const max = endOfDay(addDays(startOfDay(n), schedule.maxDaysAhead));
  return !isBefore(date, startOfDay(n)) && !isAfter(date, max);
}
