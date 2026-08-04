import { formatDistanceToNowStrict } from "date-fns";
import {
  getZonedParts,
  todayDateInputInZone,
  zonedWallTimeToUtc,
} from "@/lib/org-timezone";
import { canAutoScheduleFollowupEmail } from "@/lib/followup-plans";
import type { ChannelKey, Followup } from "@/lib/types";

export type FollowupDueBucket = "overdue" | "today" | "thisWeek" | "later" | "failed";

export type ReschedulePresetId =
  | "plus1h"
  | "plus2h"
  | "tomorrow9"
  | "tomorrowSame"
  | "nextMonday9"
  | "custom";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatWallInZone(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(date);
  } catch {
    return "";
  }
}

/** Pure YMD arithmetic (timezone-independent calendar days). */
function addCalendarDaysYmd(ymd: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!match) return ymd;
  const utc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + days,
    12,
    0,
    0,
  );
  const d = new Date(utc);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Next occurrence of weekday (0=Sun … 6=Sat), always strictly after `fromYmd`. */
export function nextWeekdayYmd(fromYmd: string, weekday: number, _timeZone?: string): string {
  let ymd = fromYmd;
  for (let i = 0; i < 8; i++) {
    ymd = addCalendarDaysYmd(ymd, 1);
    const probe = new Date(`${ymd}T12:00:00.000Z`);
    if (probe.getUTCDay() === weekday) return ymd;
  }
  return addCalendarDaysYmd(fromYmd, 7);
}

export function isFollowupRetryable(f: {
  deliveryStatus?: string;
  scheduledEmailId?: string;
}): boolean {
  return (
    Boolean(f.scheduledEmailId) &&
    (f.deliveryStatus === "failed" || f.deliveryStatus === "needs_retry")
  );
}

export function isFollowupDeliveryIssue(f: { deliveryStatus?: string }): boolean {
  return f.deliveryStatus === "failed" || f.deliveryStatus === "needs_retry";
}

/**
 * Whether "Try now" can queue an outbound email (vs only bumping the due time).
 * Ignores an existing scheduledEmailId so callers can cancel + re-queue ASAP.
 */
export function canTryNowScheduleEmail(
  f: Pick<
    Followup,
    "messageBody" | "hasMessageBody" | "pausedAt" | "completedAt" | "channel" | "scheduledEmailId"
  >,
  leadChannel: ChannelKey,
): boolean {
  if (f.pausedAt || f.completedAt) return false;
  return canAutoScheduleFollowupEmail(
    {
      ...f,
      scheduledEmailId: undefined,
      completedAt: undefined,
      pausedAt: undefined,
    } as Followup,
    leadChannel,
  );
}

export type FollowupTryNowPlan =
  | { kind: "retry" }
  | { kind: "schedule"; requeue: boolean }
  | { kind: "bump_due" };

/** Decide how Try now should act for one open followup. */
export function planFollowupTryNow(
  f: Followup,
  leadChannel: ChannelKey | undefined,
): FollowupTryNowPlan {
  if (isFollowupRetryable(f)) return { kind: "retry" };
  if (leadChannel && canTryNowScheduleEmail(f, leadChannel)) {
    return { kind: "schedule", requeue: Boolean(f.scheduledEmailId) };
  }
  return { kind: "bump_due" };
}

/** ASAP send time: at least ~90s out, staggered for bulk. */
export function tryNowScheduleAtIso(index = 0, now = Date.now()): string {
  return new Date(now + 90_000 + index * 60_000).toISOString();
}

/** Due bump when we cannot send email automatically. */
export function tryNowDueAtIso(now = Date.now()): string {
  return new Date(now + 60_000).toISOString();
}

/**
 * Bucket-aware due label in the org timezone (not the viewer's local clock).
 */
export function formatFollowupDueLabel(
  dueAt: string,
  bucket: FollowupDueBucket,
  timeZone: string,
  options?: { isViewToday?: boolean; now?: Date },
): { label: string; soon: boolean } {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return { label: "—", soon: false };

  const now = options?.now ?? new Date();
  const msUntil = due.getTime() - now.getTime();
  const soon = msUntil > 0 && msUntil <= 2 * 60 * 60 * 1000;

  let relative = "";
  try {
    relative = formatDistanceToNowStrict(due, { addSuffix: true });
  } catch {
    relative = "";
  }

  const timeOnly = formatWallInZone(due, timeZone, {
    hour: "numeric",
    minute: "2-digit",
  });
  const dateTime = formatWallInZone(due, timeZone, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const weekdayDateTime = formatWallInZone(due, timeZone, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  if (bucket === "today" && options?.isViewToday !== false) {
    return {
      label: relative ? `${timeOnly} · ${relative}` : timeOnly,
      soon,
    };
  }

  if (bucket === "thisWeek") {
    return {
      label: relative ? `${weekdayDateTime} · ${relative}` : weekdayDateTime,
      soon,
    };
  }

  // overdue, later, failed, or viewing a non-today agenda day in the "today" bucket
  return {
    label: relative ? `${dateTime} · ${relative}` : dateTime,
    soon,
  };
}

export function dueAtForReschedulePreset(
  preset: Exclude<ReschedulePresetId, "custom">,
  timeZone: string,
  options?: { referenceDueAt?: string; now?: Date },
): string {
  const now = options?.now ?? new Date();
  const todayYmd = todayDateInputInZone(timeZone, now);

  if (preset === "plus1h") {
    return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  }
  if (preset === "plus2h") {
    return new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
  }

  if (preset === "tomorrow9") {
    const ymd = addCalendarDaysYmd(todayYmd, 1);
    return zonedWallTimeToUtc(ymd, 9, 0, 0, 0, timeZone).toISOString();
  }

  if (preset === "tomorrowSame") {
    const ref = options?.referenceDueAt ? new Date(options.referenceDueAt) : now;
    const parts = Number.isNaN(ref.getTime())
      ? getZonedParts(now, timeZone)
      : getZonedParts(ref, timeZone);
    const ymd = addCalendarDaysYmd(todayYmd, 1);
    return zonedWallTimeToUtc(ymd, parts.hour, parts.minute, 0, 0, timeZone).toISOString();
  }

  // nextMonday9
  const monday = nextWeekdayYmd(todayYmd, 1);
  return zonedWallTimeToUtc(monday, 9, 0, 0, 0, timeZone).toISOString();
}

export function customDueAtFromInputs(
  dueDate: string,
  dueTime: string,
  timeZone: string,
): string {
  const hm = /^\d{1,2}:\d{2}$/.test(dueTime.trim()) ? dueTime.trim() : "09:00";
  const [hRaw, mRaw = "0"] = hm.split(":");
  const hour = Number(hRaw);
  const minute = Number(mRaw);
  return zonedWallTimeToUtc(
    dueDate,
    Number.isFinite(hour) ? hour : 9,
    Number.isFinite(minute) ? minute : 0,
    0,
    0,
    timeZone,
  ).toISOString();
}

export function defaultCustomDueInputs(
  timeZone: string,
  referenceDueAt?: string,
): { dueDate: string; dueTime: string } {
  const tomorrow = addCalendarDaysYmd(todayDateInputInZone(timeZone), 1);
  if (referenceDueAt) {
    const d = new Date(referenceDueAt);
    if (!Number.isNaN(d.getTime())) {
      const p = getZonedParts(d, timeZone);
      return { dueDate: tomorrow, dueTime: `${pad2(p.hour)}:${pad2(p.minute)}` };
    }
  }
  return { dueDate: tomorrow, dueTime: "09:00" };
}
