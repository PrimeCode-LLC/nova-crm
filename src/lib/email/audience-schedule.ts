import { addUtcDayKey } from "@/lib/email/mailbox-schedule-capacity";
import {
  isValidIanaTimezone,
  resolveOrgTimezone,
  zonedDayKey,
  zonedWallTimeToUtc,
} from "@/lib/org-timezone";
import { toDatetimeLocalValue } from "@/lib/schedule-followup-email-client";

/** Default soft send window in audience-local hours (inclusive start, exclusive end). */
export const DEFAULT_SEND_WINDOW_START_HOUR = 9;
export const DEFAULT_SEND_WINDOW_END_HOUR = 12;

export type AudienceSendWindow = {
  startHour: number;
  endHour: number;
};

/**
 * Prefer strategy audience timezone when set; otherwise org / browser fallback.
 * Quota and ops dashboards keep using org timezone separately.
 */
export function resolveScheduleTimezone(
  audienceTimezone: string | null | undefined,
  orgTimezone?: string | null,
): string {
  const audience = audienceTimezone?.trim();
  if (audience && isValidIanaTimezone(audience)) return audience;
  return resolveOrgTimezone(orgTimezone);
}

export function normalizeSendWindow(
  startHour?: number | null,
  endHour?: number | null,
): AudienceSendWindow {
  let start =
    startHour == null || !Number.isFinite(startHour)
      ? DEFAULT_SEND_WINDOW_START_HOUR
      : Math.floor(startHour);
  let end =
    endHour == null || !Number.isFinite(endHour)
      ? DEFAULT_SEND_WINDOW_END_HOUR
      : Math.floor(endHour);
  start = Math.min(23, Math.max(0, start));
  end = Math.min(24, Math.max(0, end));
  if (end <= start) {
    end = Math.min(24, start + 1);
  }
  return { startHour: start, endHour: end };
}

/**
 * Stable unit value in [0, 1) from an arbitrary key (FNV-1a).
 * Deterministic so schedule previews do not jump between renders.
 */
function hashToUnit(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Next datetime-local wall clock in `timeZone` inside the soft send window.
 * If `preferIso` lands on a future calendar day, snaps that day to the window
 * (instead of noon due-dates). If the preferred day/window is already past,
 * walks forward day by day.
 *
 * `spreadKey` distributes the send across the window instead of pinning every
 * email to the exact start hour, which would otherwise emit an identical
 * timestamp for every prospect in a bulk batch.
 */
export function defaultAudienceScheduleDatetimeLocal(input: {
  preferIso?: string;
  timeZone?: string;
  sendWindowStartHour?: number | null;
  sendWindowEndHour?: number | null;
  now?: Date;
  /** Stable per-email key (e.g. follow-up id). Omit to pin to the window start. */
  spreadKey?: string;
}): string {
  const zone = resolveOrgTimezone(input.timeZone);
  const window = normalizeSendWindow(input.sendWindowStartHour, input.sendWindowEndHour);
  const now = input.now ?? new Date();
  const minMs = now.getTime() + 60_000;

  const spreadKey = input.spreadKey?.trim();
  const windowMinutes = Math.max(1, (window.endHour - window.startHour) * 60);
  const spreadMinutes = spreadKey
    ? Math.floor(hashToUnit(spreadKey) * windowMinutes)
    : 0;

  const slotOnDay = (dayKey: string): Date | null => {
    const windowStart = zonedWallTimeToUtc(dayKey, window.startHour, 0, 0, 0, zone);
    const windowEnd = zonedWallTimeToUtc(dayKey, window.endHour, 0, 0, 0, zone);
    if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime())) return null;
    if (minMs > windowEnd.getTime()) return null;
    const spread = windowStart.getTime() + spreadMinutes * 60_000;
    const ms = Math.max(minMs, Math.min(spread, windowEnd.getTime()));
    if (ms > windowEnd.getTime()) return null;
    return new Date(ms);
  };

  if (input.preferIso) {
    const preferred = new Date(input.preferIso);
    if (!Number.isNaN(preferred.getTime())) {
      const dayKey = zonedDayKey(preferred, zone);
      const snapped = slotOnDay(dayKey);
      if (snapped) return toDatetimeLocalValue(snapped, zone);
    }
  }

  const todayKey = zonedDayKey(now, zone);
  for (let offset = 0; offset < 14; offset += 1) {
    const dayKey = addUtcDayKey(todayKey, offset);
    const slot = slotOnDay(dayKey);
    if (slot) return toDatetimeLocalValue(slot, zone);
  }

  return toDatetimeLocalValue(new Date(minMs), zone);
}

export function resolveLeadScheduleTimezone(input: {
  strategyId?: string | null;
  strategies: readonly { id: string; audienceTimezone?: string | null }[];
  orgTimezone?: string | null;
}): string {
  const strategyId = input.strategyId?.trim();
  const strategy = strategyId
    ? input.strategies.find((s) => s.id === strategyId)
    : undefined;
  return resolveScheduleTimezone(strategy?.audienceTimezone, input.orgTimezone);
}

export function resolveLeadSendWindow(input: {
  strategyId?: string | null;
  strategies: readonly {
    id: string;
    sendWindowStartHour?: number | null;
    sendWindowEndHour?: number | null;
  }[];
}): AudienceSendWindow {
  const strategyId = input.strategyId?.trim();
  const strategy = strategyId
    ? input.strategies.find((s) => s.id === strategyId)
    : undefined;
  return normalizeSendWindow(strategy?.sendWindowStartHour, strategy?.sendWindowEndHour);
}
