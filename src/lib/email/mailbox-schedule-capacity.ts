import type { ScheduledEmail } from "@/lib/email-account-types";
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

/** UTC calendar day from a Date / ISO / datetime-local value. */
export function utcDayKeyFromDate(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function addUtcDayKey(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return dayKey;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatUtcDayLabel(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Build day loads from demo store scheduled rows (no sendStats). */
export function buildDemoMailboxDayLoads(input: {
  scheduled: ScheduledEmail[];
  mailboxId: string;
  dailySendLimit: number | null | undefined;
  horizonDays?: number;
}): MailboxScheduleLoadResponse {
  const limit =
    input.dailySendLimit == null ||
    !Number.isFinite(input.dailySendLimit) ||
    input.dailySendLimit <= 0
      ? null
      : Math.floor(input.dailySendLimit);
  const fromDayKey = utcDayKeyFromDate(new Date());
  const horizon = input.horizonDays ?? 60;
  const toDayKey = addUtcDayKey(fromDayKey, horizon - 1);
  const pendingByDay: Record<string, number> = {};
  for (const row of input.scheduled) {
    if (row.mailboxId !== input.mailboxId) continue;
    if (row.status !== "pending" && row.status !== "processing") continue;
    const dayKey = utcDayKeyFromDate(row.scheduledAt);
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
 * Project capacity for each included step, accounting for other draft steps on the same UTC day.
 */
export function projectStepCapacity(input: {
  steps: { id: string; scheduledAt: string; included: boolean }[];
  byDay: Record<string, MailboxDayLoadClient>;
  limit: number | null;
}): {
  byStepId: Record<string, StepCapacityInfo>;
  overLimitDayKeys: string[];
  overLimitStepIds: string[];
} {
  const byStepId: Record<string, StepCapacityInfo> = {};
  const overLimitStepIds: string[] = [];
  const overLimitDayKeys = new Set<string>();

  if (input.limit == null) {
    for (const step of input.steps) {
      if (!step.included) continue;
      const dayKey = utcDayKeyFromDate(step.scheduledAt);
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
    const dayKey = utcDayKeyFromDate(step.scheduledAt);
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

function advanceLocalCalendarDay(d: Date, hours: number, minutes: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, hours, minutes, 0, 0);
}

/**
 * Move over-limit steps to the next UTC day with free capacity.
 * Preserves local time-of-day and relative order (later steps never move before earlier ones).
 */
export function autoFixScheduleDates<T extends { id: string; scheduledAt: string; included: boolean }>(
  steps: T[],
  byDay: Record<string, MailboxDayLoadClient>,
  limit: number | null,
  horizonDays = 60,
): { steps: T[]; changed: boolean; unresolvedIds: string[] } {
  if (limit == null) {
    return { steps, changed: false, unresolvedIds: [] };
  }

  const remaining: Record<string, number> = {};
  const todayKey = utcDayKeyFromDate(new Date());
  const endKey = addUtcDayKey(todayKey, horizonDays - 1);
  for (let key = todayKey; key <= endKey; key = addUtcDayKey(key, 1)) {
    remaining[key] = byDay[key]?.remaining ?? limit;
  }

  const next = steps.map((s) => ({ ...s }));
  const included = next
    .filter((s) => s.included && s.scheduledAt)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id));

  let changed = false;
  const unresolvedIds: string[] = [];
  let minTime = Date.now() + 60_000;

  for (const step of included) {
    const original = new Date(step.scheduledAt);
    if (Number.isNaN(original.getTime())) continue;
    const hours = original.getHours();
    const minutes = original.getMinutes();

    let probe = new Date(original);
    if (probe.getTime() < minTime) {
      probe = new Date(minTime);
      probe.setSeconds(0, 0);
      // Prefer original wall-clock time on/after minTime
      const preferred = new Date(
        probe.getFullYear(),
        probe.getMonth(),
        probe.getDate(),
        hours,
        minutes,
        0,
        0,
      );
      probe = preferred.getTime() >= minTime ? preferred : probe;
    }

    let placed = false;
    for (let guard = 0; guard < horizonDays + 2; guard += 1) {
      const dayKey = utcDayKeyFromDate(probe);
      if (!dayKey || dayKey > endKey) break;
      const slots = remaining[dayKey] ?? 0;
      if (slots > 0) {
        const localValue = toDatetimeLocalValue(probe);
        if (localValue !== step.scheduledAt) {
          step.scheduledAt = localValue;
          changed = true;
        }
        remaining[dayKey] = slots - 1;
        minTime = probe.getTime() + 60_000;
        placed = true;
        break;
      }
      probe = advanceLocalCalendarDay(probe, hours, minutes);
    }

    if (!placed) unresolvedIds.push(step.id);
  }

  const byId = new Map(included.map((s) => [s.id, s]));
  const merged = next.map((s) => {
    const updated = byId.get(s.id);
    return updated ? { ...s, scheduledAt: updated.scheduledAt } : s;
  });

  return { steps: merged, changed, unresolvedIds };
}
