import { addUtcDayKey } from "@/lib/email/mailbox-schedule-capacity";
import {
  intersectSendWindowWithPolicy,
  isOrgWorkingDay,
  resolveOrgSendPolicy,
  type OrgEmailSendPolicy,
} from "@/lib/email/org-send-policy";
import {
  resolveOrgTimezone,
  zonedDayKey,
  zonedWallTimeToUtc,
  isValidIanaTimezone,
} from "@/lib/org-timezone";
import { toDatetimeLocalValue } from "@/lib/schedule-followup-email-client";

/** Default soft send window in workspace-timezone hours (inclusive start, exclusive end). */
export const DEFAULT_SEND_WINDOW_START_HOUR = 9;
export const DEFAULT_SEND_WINDOW_END_HOUR = 12;

export type AudienceSendWindow = {
  startHour: number;
  endHour: number;
};

/**
 * Prefer recipient contact timezone, then strategy audienceTimezone, then org timezone.
 */
export function resolveScheduleTimezone(
  audienceTimezone?: string | null,
  orgTimezone?: string | null,
  recipientTimezone?: string | null,
): string {
  for (const candidate of [recipientTimezone, audienceTimezone, orgTimezone]) {
    const value = candidate?.trim();
    if (value && isValidIanaTimezone(value)) return value;
  }
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
  /** Org working-hours policy. When set, non-working days are skipped. */
  sendPolicy?: OrgEmailSendPolicy | null;
}): string {
  const zone = resolveOrgTimezone(input.timeZone);
  const policy = input.sendPolicy ? resolveOrgSendPolicy(input.sendPolicy) : null;
  const baseWindow = normalizeSendWindow(input.sendWindowStartHour, input.sendWindowEndHour);
  const window = policy ? intersectSendWindowWithPolicy(baseWindow, policy) : baseWindow;
  const now = input.now ?? new Date();
  const minMs = now.getTime() + 60_000;

  const spreadKey = input.spreadKey?.trim();
  const spreadUnit = spreadKey ? hashToUnit(spreadKey) : 0;

  const slotOnDay = (dayKey: string): Date | null => {
    if (policy && !isOrgWorkingDay(dayKey, policy, zone)) return null;
    const windowStart = zonedWallTimeToUtc(dayKey, window.startHour, 0, 0, 0, zone);
    const windowEnd = zonedWallTimeToUtc(dayKey, window.endHour, 0, 0, 0, zone);
    if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime())) return null;
    if (minMs > windowEnd.getTime()) return null;
    // Spread across the part of the window that is still ahead. Spreading from
    // windowStart and then clamping to `minMs` collapses a mid-window batch onto
    // one identical timestamp, which then drains at the per-mailbox send gap.
    const earliest = Math.max(windowStart.getTime(), minMs);
    const usableMinutes = Math.max(0, Math.floor((windowEnd.getTime() - earliest) / 60_000));
    const offsetMinutes = Math.floor(spreadUnit * usableMinutes);
    const ms = Math.min(earliest + offsetMinutes * 60_000, windowEnd.getTime());
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
  for (let offset = 0; offset < 21; offset += 1) {
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
  /** Contact IANA timezone when known. */
  recipientTimezone?: string | null;
}): string {
  const strategyId = input.strategyId?.trim();
  const strategy = strategyId
    ? input.strategies.find((s) => s.id === strategyId)
    : undefined;
  return resolveScheduleTimezone(
    strategy?.audienceTimezone,
    input.orgTimezone,
    input.recipientTimezone,
  );
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
