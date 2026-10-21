import { addUtcDayKey } from "@/lib/email/mailbox-schedule-capacity";
import {
  getZonedParts,
  resolveOrgTimezone,
  zonedDayKey,
  zonedWallTimeToUtc,
} from "@/lib/org-timezone";
import { DEFAULT_WEEKLY_AVAILABILITY, WEEKDAY_KEYS } from "@/lib/scheduling/defaults";
import type {
  AvailabilityTimeSlot,
  OrgEmailSendPolicy,
  WeekdayKey,
  WeeklyAvailability,
} from "@/lib/types";

export type { OrgEmailSendPolicy };

export const DEFAULT_ORG_SEND_POLICY: OrgEmailSendPolicy = {
  weekly: structuredClone(DEFAULT_WEEKLY_AVAILABILITY),
  weekdayOnly: true,
  dailyCeiling: null,
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function cloneWeekly(weekly: WeeklyAvailability): WeeklyAvailability {
  const out = {} as WeeklyAvailability;
  for (const key of WEEKDAY_KEYS) {
    out[key] = (weekly[key] ?? []).map((slot) => ({ start: slot.start, end: slot.end }));
  }
  return out;
}

function parseSlot(raw: unknown): AvailabilityTimeSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const start = String((raw as { start?: unknown }).start ?? "").trim();
  const end = String((raw as { end?: unknown }).end ?? "").trim();
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) return null;
  if (end <= start) return null;
  return { start, end };
}

export function parseOrgSendPolicy(raw: unknown): OrgEmailSendPolicy | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const weeklyRaw = o.weekly;
  let weekly = cloneWeekly(DEFAULT_WEEKLY_AVAILABILITY);
  if (weeklyRaw && typeof weeklyRaw === "object") {
    const next = {} as WeeklyAvailability;
    for (const key of WEEKDAY_KEYS) {
      const day = (weeklyRaw as Record<string, unknown>)[key];
      if (!Array.isArray(day)) {
        next[key] = [];
        continue;
      }
      next[key] = day.map(parseSlot).filter(Boolean) as AvailabilityTimeSlot[];
    }
    weekly = next;
  }
  const ceilingRaw = o.dailyCeiling;
  let dailyCeiling: number | null = null;
  if (ceilingRaw != null && ceilingRaw !== "") {
    const n = Number(ceilingRaw);
    if (Number.isFinite(n) && n > 0) dailyCeiling = Math.floor(n);
  }
  return {
    weekly,
    weekdayOnly: o.weekdayOnly !== false,
    dailyCeiling,
  };
}

export function resolveOrgSendPolicy(
  raw?: Partial<OrgEmailSendPolicy> | null,
): OrgEmailSendPolicy {
  if (!raw) return structuredClone(DEFAULT_ORG_SEND_POLICY);
  return {
    weekly: cloneWeekly(raw.weekly ?? DEFAULT_WEEKLY_AVAILABILITY),
    weekdayOnly: raw.weekdayOnly !== false,
    dailyCeiling:
      raw.dailyCeiling == null || !Number.isFinite(raw.dailyCeiling) || raw.dailyCeiling <= 0
        ? null
        : Math.floor(raw.dailyCeiling),
  };
}

export function weekdayKeyFromDayKey(dayKey: string, timeZone: string): WeekdayKey {
  const zone = resolveOrgTimezone(timeZone);
  const instant = zonedWallTimeToUtc(dayKey, 12, 0, 0, 0, zone);
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: zone,
  })
    .format(instant)
    .toLowerCase();
  if ((WEEKDAY_KEYS as readonly string[]).includes(weekday)) {
    return weekday as WeekdayKey;
  }
  const parts = getZonedParts(instant, zone);
  const utcNoon = Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0);
  return WEEKDAY_KEYS[new Date(utcNoon).getUTCDay()]!;
}

export function isOrgWorkingDay(
  dayKey: string,
  policy: OrgEmailSendPolicy,
  timeZone: string,
): boolean {
  const key = weekdayKeyFromDayKey(dayKey, timeZone);
  const slots = policy.weekly[key] ?? [];
  if (slots.length > 0) return true;
  if (!policy.weekdayOnly) return true;
  return false;
}

export function orgPolicyHourWindow(policy: OrgEmailSendPolicy): {
  startHour: number;
  endHour: number;
} {
  let startMinutes = 9 * 60;
  let endMinutes = 17 * 60;
  let found = false;
  for (const key of WEEKDAY_KEYS) {
    for (const slot of policy.weekly[key] ?? []) {
      const [sh, sm] = slot.start.split(":").map(Number);
      const [eh, em] = slot.end.split(":").map(Number);
      const start = (sh ?? 0) * 60 + (sm ?? 0);
      const end = (eh ?? 0) * 60 + (em ?? 0);
      if (!found) {
        startMinutes = start;
        endMinutes = end;
        found = true;
      } else {
        startMinutes = Math.min(startMinutes, start);
        endMinutes = Math.max(endMinutes, end);
      }
    }
  }
  return {
    startHour: Math.min(23, Math.max(0, Math.floor(startMinutes / 60))),
    endHour: Math.min(24, Math.max(1, Math.ceil(endMinutes / 60))),
  };
}

/** Intersect strategy send window with org working hours. */
export function intersectSendWindowWithPolicy(
  strategy: { startHour: number; endHour: number },
  policy: OrgEmailSendPolicy,
): { startHour: number; endHour: number } {
  const org = orgPolicyHourWindow(policy);
  const start = Math.max(strategy.startHour, org.startHour);
  const end = Math.min(strategy.endHour, org.endHour);
  if (end <= start) {
    return { startHour: org.startHour, endHour: Math.min(24, org.startHour + 1) };
  }
  return { startHour: start, endHour: end };
}

export function nextOrgWorkingDayKey(
  dayKey: string,
  policy: OrgEmailSendPolicy,
  timeZone: string,
  maxSteps = 21,
): string {
  let key = dayKey;
  for (let i = 0; i < maxSteps; i += 1) {
    if (isOrgWorkingDay(key, policy, timeZone)) return key;
    key = addUtcDayKey(key, 1);
  }
  return key;
}

export function addOrgWorkingDays(
  dayKey: string,
  days: number,
  policy: OrgEmailSendPolicy,
  timeZone: string,
): string {
  if (days <= 0) return nextOrgWorkingDayKey(dayKey, policy, timeZone);
  let key = nextOrgWorkingDayKey(dayKey, policy, timeZone);
  for (let i = 0; i < days; i += 1) {
    key = nextOrgWorkingDayKey(addUtcDayKey(key, 1), policy, timeZone);
  }
  return key;
}

function slotMinutes(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(":").map(Number);
  return { h: h ?? 0, m: m ?? 0 };
}

/**
 * When the workspace send window is next open: `null` when it is open now
 * (or no opening is found within two weeks — never block mail forever), else
 * the instant it opens. Used to defer scheduled mail at send time (QA 3.5).
 */
export function nextOrgSendWindowOpening(
  policy: OrgEmailSendPolicy,
  timeZone: string | null | undefined,
  now: Date = new Date(),
): Date | null {
  const zone = resolveOrgTimezone(timeZone);
  const nowMs = now.getTime();
  const today = zonedDayKey(now, zone);
  for (let i = 0; i < 14; i += 1) {
    const dayKey = i === 0 ? today : addUtcDayKey(today, i);
    const slots = [...(policy.weekly[weekdayKeyFromDayKey(dayKey, zone)] ?? [])].sort((a, b) =>
      a.start.localeCompare(b.start),
    );
    if (slots.length === 0) {
      if (policy.weekdayOnly) continue;
      // Not restricted to listed days: an unlisted day is open all day.
      return i === 0 ? null : zonedWallTimeToUtc(dayKey, 0, 0, 0, 0, zone);
    }
    for (const slot of slots) {
      const s = slotMinutes(slot.start);
      const e = slotMinutes(slot.end);
      const start = zonedWallTimeToUtc(dayKey, s.h, s.m, 0, 0, zone).getTime();
      const end = zonedWallTimeToUtc(dayKey, e.h, e.m, 0, 0, zone).getTime();
      if (nowMs >= start && nowMs < end) return null;
      if (start > nowMs) return new Date(start);
    }
  }
  return null;
}

