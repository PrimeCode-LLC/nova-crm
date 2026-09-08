import type { ScheduledEmail } from "@/lib/email-account-types";
import {
  isOrgWorkingDay,
  orgPolicyHourWindow,
  resolveOrgSendPolicy,
  type OrgEmailSendPolicy,
} from "@/lib/email/org-send-policy";
import {
  datetimeLocalInZone,
  isoFromDatetimeLocalInZone,
  isNaiveDatetimeLocal,
  resolveOrgTimezone,
  zonedDayKey,
  zonedWallTimeToUtc,
} from "@/lib/org-timezone";
import { toDatetimeLocalValue } from "@/lib/schedule-followup-email-client";

export type MailboxDayLoadClient = {
  dayKey: string;
  sent: number;
  pending: number;
  booked: number;
  limit: number | null;
  remaining: number | null;
};

export type MailboxScheduleLoadResponse = {
  ok: true;
  mailboxId: string;
  limit: number | null;
  fromDayKey: string;
  toDayKey: string;
  byDay: Record<string, MailboxDayLoadClient>;
};

/**
 * Calendar day key (YYYY-MM-DD) in the org (or given) timezone.
 * Naive datetime-local strings are interpreted as wall clock in that zone.
 */
export function scheduleDayKeyFromDate(value: Date | string, timeZone?: string): string {
  const zone = resolveOrgTimezone(timeZone);
  if (typeof value === "string" && isNaiveDatetimeLocal(value)) {
    const iso = isoFromDatetimeLocalInZone(value, zone);
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return zonedDayKey(d, zone);
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return zonedDayKey(d, zone);
}

/** @deprecated Prefer scheduleDayKeyFromDate with an explicit org timezone. */
export function utcDayKeyFromDate(value: Date | string, timeZone?: string): string {
  return scheduleDayKeyFromDate(value, timeZone ?? "UTC");
}

/** Add N calendar days to a YYYY-MM-DD key (zone-agnostic string math). */
export function addUtcDayKey(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return dayKey;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatScheduleDayLabel(dayKey: string, timeZone?: string): string {
  const zone = resolveOrgTimezone(timeZone);
  const d = zonedWallTimeToUtc(dayKey, 12, 0, 0, 0, zone);
  if (Number.isNaN(d.getTime())) return dayKey;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: zone,
  });
}

/** @deprecated Prefer formatScheduleDayLabel. */
export function formatUtcDayLabel(dayKey: string): string {
  return formatScheduleDayLabel(dayKey, "UTC");
}

/** Format a datetime-local wall clock (already in `timeZone`) for UI preview. */
export function formatDatetimeLocalPreview(value: string, timeZone?: string): string {
  const zone = resolveOrgTimezone(timeZone);
  const iso = isoFromDatetimeLocalInZone(value, zone);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Build day loads from demo store scheduled rows (no sendStats). */
export function buildDemoMailboxDayLoads(input: {
  scheduled: ScheduledEmail[];
  mailboxId: string;
  dailySendLimit: number | null | undefined;
  horizonDays?: number;
  timeZone?: string;
}): MailboxScheduleLoadResponse {
  const zone = resolveOrgTimezone(input.timeZone);
  const limit =
    input.dailySendLimit == null ||
    !Number.isFinite(input.dailySendLimit) ||
    input.dailySendLimit <= 0
      ? null
      : Math.floor(input.dailySendLimit);
  const fromDayKey = scheduleDayKeyFromDate(new Date(), zone);
  const horizon = input.horizonDays ?? 60;
  const toDayKey = addUtcDayKey(fromDayKey, horizon - 1);
  const pendingByDay: Record<string, number> = {};
  for (const row of input.scheduled) {
    if (row.mailboxId !== input.mailboxId) continue;
    if (row.status !== "pending" && row.status !== "processing") continue;
    const dayKey = scheduleDayKeyFromDate(row.scheduledAt, zone);
    if (!dayKey || dayKey < fromDayKey || dayKey > toDayKey) continue;
    pendingByDay[dayKey] = (pendingByDay[dayKey] ?? 0) + 1;
  }
  const byDay: Record<string, MailboxDayLoadClient> = {};
  for (let key = fromDayKey; key <= toDayKey; key = addUtcDayKey(key, 1)) {
    const pending = pendingByDay[key] ?? 0;
    const booked = pending;
    byDay[key] = {
      dayKey: key,
      sent: 0,
      pending,
      booked,
      limit,
      remaining: limit == null ? null : Math.max(0, limit - booked),
    };
  }
  return { ok: true, mailboxId: input.mailboxId, limit, fromDayKey, toDayKey, byDay };
}

export async function fetchMailboxScheduleLoad(input: {
  mailboxId: string;
  dataOwnerUid?: string | null;
  horizonDays?: number;
}): Promise<MailboxScheduleLoadResponse | { ok: false; error: string }> {
  const params = new URLSearchParams({
    mailboxId: input.mailboxId,
    horizonDays: String(input.horizonDays ?? 60),
  });
  const owner = input.dataOwnerUid?.trim();
  if (owner) params.set("forUser", owner);
  try {
    const res = await fetch(`/api/email/scheduled/load?${params.toString()}`);
    const data = (await res.json()) as MailboxScheduleLoadResponse & {
      ok?: boolean;
      error?: string;
    };
    if (!data.ok || !data.byDay) {
      return { ok: false, error: data.error ?? "Could not load mailbox capacity" };
    }
    return data;
  } catch {
    return { ok: false, error: "Could not reach the server" };
  }
}

export type StepCapacityInfo = {
  dayKey: string;
  /** Remaining after existing booked + earlier included steps that day (before this step). */
  remainingBefore: number | null;
  /** True when this step would push the day over the limit. */
  overLimit: boolean;
  booked: number;
  limit: number | null;
};

/**
 * Project capacity for each included step, accounting for other draft steps on the same org day.
 */
export function projectStepCapacity(input: {
  steps: { id: string; scheduledAt: string; included: boolean }[];
  byDay: Record<string, MailboxDayLoadClient>;
  limit: number | null;
  timeZone?: string;
}): {
  byStepId: Record<string, StepCapacityInfo>;
  overLimitDayKeys: string[];
  overLimitStepIds: string[];
} {
  const zone = resolveOrgTimezone(input.timeZone);
  const byStepId: Record<string, StepCapacityInfo> = {};
  const overLimitStepIds: string[] = [];
  const overLimitDayKeys = new Set<string>();

  if (input.limit == null) {
    for (const step of input.steps) {
      if (!step.included) continue;
      const dayKey = scheduleDayKeyFromDate(step.scheduledAt, zone);
      byStepId[step.id] = {
        dayKey,
        remainingBefore: null,
        overLimit: false,
        booked: input.byDay[dayKey]?.booked ?? 0,
        limit: null,
      };
    }
    return { byStepId, overLimitDayKeys: [], overLimitStepIds: [] };
  }

  const draftCountByDay: Record<string, number> = {};
  const ordered = input.steps
    .filter((s) => s.included && s.scheduledAt)
    .slice()
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id));

  for (const step of ordered) {
    const dayKey = scheduleDayKeyFromDate(step.scheduledAt, zone);
    const base = input.byDay[dayKey];
    const booked = base?.booked ?? 0;
    const priorDraft = draftCountByDay[dayKey] ?? 0;
    const remainingBefore = Math.max(0, input.limit - booked - priorDraft);
    const overLimit = remainingBefore <= 0;
    byStepId[step.id] = {
      dayKey,
      remainingBefore,
      overLimit,
      booked,
      limit: input.limit,
    };
    if (overLimit) {
      overLimitStepIds.push(step.id);
      if (dayKey) overLimitDayKeys.add(dayKey);
    }
    draftCountByDay[dayKey] = priorDraft + 1;
  }

  return {
    byStepId,
    overLimitDayKeys: [...overLimitDayKeys].sort(),
    overLimitStepIds,
  };
}

function advanceZonedCalendarDay(
  instant: Date,
  hours: number,
  minutes: number,
  timeZone: string,
): Date {
  const nextKey = addUtcDayKey(zonedDayKey(instant, timeZone), 1);
  return zonedWallTimeToUtc(nextKey, hours, minutes, 0, 0, timeZone);
}

/**
 * Move over-limit steps to the next org-calendar day with free capacity.
 * Preserves wall-clock time-of-day in `timeZone`, relative order, and the
 * original gaps between consecutive steps when an earlier step spills forward.
 */
export function autoFixScheduleDates<T extends { id: string; scheduledAt: string; included: boolean }>(
  steps: T[],
  byDay: Record<string, MailboxDayLoadClient>,
  limit: number | null,
  horizonDays = 60,
  timeZone?: string,
  options?: {
    sendPolicy?: OrgEmailSendPolicy | null;
    orgCeiling?: number | null;
    orgRemainingByDay?: Record<string, number>;
    /** Clock for capacity horizon + min placement (tests); defaults to Date.now(). */
    now?: Date;
  },
): {
  steps: T[];
  changed: boolean;
  unresolvedIds: string[];
  orgRemainingByDay?: Record<string, number>;
} {
  const zone = resolveOrgTimezone(timeZone);
  const policy = options?.sendPolicy ? resolveOrgSendPolicy(options.sendPolicy) : null;
  const orgCeiling =
    options?.orgCeiling == null || !Number.isFinite(options.orgCeiling) || options.orgCeiling <= 0
      ? null
      : Math.floor(options.orgCeiling);
  const orgRemaining: Record<string, number> | null =
    orgCeiling == null
      ? null
      : { ...(options?.orgRemainingByDay ?? {}) };

  if (limit == null && orgCeiling == null && !policy) {
    return { steps, changed: false, unresolvedIds: [] };
  }

  const nowMs =
    options?.now && !Number.isNaN(options.now.getTime()) ? options.now.getTime() : Date.now();
  const remaining: Record<string, number> = {};
  const todayKey = scheduleDayKeyFromDate(new Date(nowMs), zone);
  const endKey = addUtcDayKey(todayKey, horizonDays - 1);
  for (let key = todayKey; key <= endKey; key = addUtcDayKey(key, 1)) {
    const working = !policy || isOrgWorkingDay(key, policy, zone);
    if (!working) {
      remaining[key] = 0;
      if (orgRemaining) orgRemaining[key] = 0;
      continue;
    }
    remaining[key] = limit == null ? Number.POSITIVE_INFINITY : (byDay[key]?.remaining ?? limit);
    if (orgRemaining && orgRemaining[key] == null) {
      orgRemaining[key] = orgCeiling!;
    }
  }

  const next = steps.map((s) => ({ ...s }));
  const included = next
    .filter((s) => s.included && s.scheduledAt)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id));

  let changed = false;
  const unresolvedIds: string[] = [];
  let minTime = nowMs + 60_000;
  let prevOriginalMs: number | null = null;
  let prevPlacedMs: number | null = null;

  for (const step of included) {
    const originalIso = isNaiveDatetimeLocal(step.scheduledAt)
      ? isoFromDatetimeLocalInZone(step.scheduledAt, zone)
      : step.scheduledAt;
    const original = new Date(originalIso);
    if (Number.isNaN(original.getTime())) continue;
    const wall = datetimeLocalInZone(original, zone);
    const [datePart, timePart = "00:00"] = wall.split("T");
    const [hRaw, mRaw = "0"] = timePart.split(":");
    const hours = Number(hRaw);
    const minutes = Number(mRaw);
    if (!datePart || !Number.isFinite(hours) || !Number.isFinite(minutes)) continue;

    const originalMs = original.getTime();
    let probe = original;
    // When an earlier step spilled forward, keep this step's original gap after it
    // instead of collapsing to +60s (which stacks a whole sequence onto one/two days).
    if (prevOriginalMs != null && prevPlacedMs != null) {
      const originalGapMs = Math.max(60_000, originalMs - prevOriginalMs);
      const anchored = new Date(prevPlacedMs + originalGapMs);
      if (anchored.getTime() > probe.getTime()) {
        probe = anchored;
      }
    }
    if (probe.getTime() < minTime) {
      const minWall = datetimeLocalInZone(new Date(minTime), zone);
      const [minDate] = minWall.split("T");
      const preferred = zonedWallTimeToUtc(
        minDate!,
        hours,
        minutes,
        0,
        0,
        zone,
      );
      probe = preferred.getTime() >= minTime ? preferred : new Date(minTime);
    }

    if (policy) {
      const { startHour, endHour } = orgPolicyHourWindow(policy);
      for (let i = 0; i < horizonDays + 2; i += 1) {
        const dayKey = scheduleDayKeyFromDate(probe, zone);
        if (!dayKey) break;
        if (!isOrgWorkingDay(dayKey, policy, zone)) {
          probe = zonedWallTimeToUtc(
            addUtcDayKey(dayKey, 1),
            Math.max(startHour, hours),
            minutes,
            0,
            0,
            zone,
          );
          continue;
        }
        const windowStart = zonedWallTimeToUtc(dayKey, startHour, 0, 0, 0, zone);
        const windowEnd = zonedWallTimeToUtc(dayKey, endHour, 0, 0, 0, zone);
        if (probe.getTime() < windowStart.getTime()) {
          const snapped = zonedWallTimeToUtc(
            dayKey,
            Math.max(startHour, hours),
            minutes,
            0,
            0,
            zone,
          );
          probe = snapped.getTime() >= windowStart.getTime() ? snapped : windowStart;
        }
        if (probe.getTime() >= minTime && probe.getTime() < windowEnd.getTime()) break;
        probe = zonedWallTimeToUtc(
          addUtcDayKey(dayKey, 1),
          Math.max(startHour, hours),
          minutes,
          0,
          0,
          zone,
        );
      }
    }

    let placed = false;
    for (let guard = 0; guard < horizonDays + 2; guard += 1) {
      const dayKey = scheduleDayKeyFromDate(probe, zone);
      if (!dayKey || dayKey > endKey) break;
      const slots = remaining[dayKey] ?? 0;
      const orgSlots = orgRemaining ? (orgRemaining[dayKey] ?? 0) : Number.POSITIVE_INFINITY;
      if (slots > 0 && orgSlots > 0) {
        const localValue = toDatetimeLocalValue(probe, zone);
        if (localValue !== step.scheduledAt) {
          step.scheduledAt = localValue;
          changed = true;
        }
        remaining[dayKey] = slots - 1;
        if (orgRemaining) orgRemaining[dayKey] = orgSlots - 1;
        prevOriginalMs = originalMs;
        prevPlacedMs = probe.getTime();
        minTime = probe.getTime() + 60_000;
        placed = true;
        break;
      }
      probe = advanceZonedCalendarDay(probe, hours, minutes, zone);
    }

    if (!placed) unresolvedIds.push(step.id);
  }

  const byId = new Map(included.map((s) => [s.id, s]));
  const merged = next.map((s) => {
    const updated = byId.get(s.id);
    return updated ? { ...s, scheduledAt: updated.scheduledAt } : s;
  });

  return { steps: merged, changed, unresolvedIds, orgRemainingByDay: orgRemaining ?? undefined };
}
