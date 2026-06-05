import type { WeeklyAvailability } from "@/lib/types";

export const DEFAULT_WEEKLY_AVAILABILITY: WeeklyAvailability = {
  sunday: [],
  monday: [{ start: "09:00", end: "17:00" }],
  tuesday: [{ start: "09:00", end: "17:00" }],
  wednesday: [{ start: "09:00", end: "17:00" }],
  thursday: [{ start: "09:00", end: "17:00" }],
  friday: [{ start: "09:00", end: "17:00" }],
  saturday: [],
};

export const DEFAULT_TIMEZONE = "America/New_York";

export const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export function weekdayKeyFromDate(date: Date): (typeof WEEKDAY_KEYS)[number] {
  return WEEKDAY_KEYS[date.getDay()]!;
}
