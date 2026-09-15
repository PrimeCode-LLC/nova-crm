import { addUtcDayKey } from "@/lib/email/mailbox-schedule-capacity";
import {
  resolveOrgTimezone,
  zonedDayKey,
  zonedWallTimeToUtc,
} from "@/lib/org-timezone";

/** Max auto-retries for transient SMTP / network failures before permanent fail. */
export const SCHEDULED_SEND_MAX_ATTEMPTS = 3;

/**
 * Max consecutive daily-quota deferrals before the send is failed outright.
 * Quota deferrals do not consume a send attempt, so without a ceiling a mailbox
 * that is permanently over its limit defers the same email forever, invisibly.
 */
export const SCHEDULED_QUOTA_MAX_DEFERRALS = 3;

/** Default inter-send gap (seconds) when mailbox has no override. */
export const DEFAULT_SEND_GAP_SECONDS = 15;

/** Allowed range for mailbox `sendGapSeconds`. */
export const SEND_GAP_SECONDS_MIN = 0;
export const SEND_GAP_SECONDS_MAX = 120;

export type ScheduledFailureKind = "transient" | "permanent" | "quota";

const PERMANENT_PATTERNS = [
  /mailbox no longer exists/i,
  /authentication failed/i,
  /invalid login/i,
  /auth.*revoked/i,
  /token.*expired/i,
  /recipient.*reject/i,
  /user unknown/i,
  /mailbox unavailable/i,
  /address rejected/i,
  /no such user/i,
  /550[-\s]/,
  /551[-\s]/,
  /552[-\s]/,
  /553[-\s]/,
  /554[-\s].*reject/i,
  /relay access denied/i,
  /sender address rejected/i,
  /daily send limit full for/i, // schedule-time wording; send-time quota is handled separately
];

const QUOTA_PATTERNS = [/daily send limit reached/i, /daily send limit full/i];

const TRANSIENT_PATTERNS = [
  /etimedout/i,
  /econnreset/i,
  /econnrefused/i,
  /enotfound/i,
  /socket hang up/i,
  /connection timeout/i,
  /socket timeout/i,
  /temporary/i,
  /try again/i,
  /rate.?limit/i,
  /too many/i,
  /421[-\s]/,
  /450[-\s]/,
  /451[-\s]/,
  /452[-\s]/,
  /greylist/i,
  /deferred/i,
];

/**
 * Classify a send/schedule error so the cron can retry, defer, or permanently fail.
 * Quota is also detected from dedicated send-path checks - pass `kindHint: "quota"` when known.
 */
export function classifyScheduledSendError(
  error: string,
  kindHint?: ScheduledFailureKind,
): ScheduledFailureKind {
  if (kindHint) return kindHint;
  const msg = (error || "").trim();
  if (!msg) return "transient";
  if (QUOTA_PATTERNS.some((re) => re.test(msg))) return "quota";
  if (PERMANENT_PATTERNS.some((re) => re.test(msg))) return "permanent";
  if (TRANSIENT_PATTERNS.some((re) => re.test(msg))) return "transient";
  // Unknown SMTP / transport errors: retry a few times rather than killing the step.
  return "transient";
}

/** Backoff after attempt N failed (1-based attempt count after the failure). */
export function scheduledSendRetryDelayMs(attemptAfterFailure: number): number {
  const n = Math.max(1, Math.floor(attemptAfterFailure));
  if (n <= 1) return 10 * 60_000; // 10 min
  if (n === 2) return 60 * 60_000; // 1 h
  return 6 * 60 * 60_000; // 6 h
}

export function nextRetryAtIso(attemptAfterFailure: number, now = new Date()): string {
  return new Date(now.getTime() + scheduledSendRetryDelayMs(attemptAfterFailure)).toISOString();
}

/**
 * Start of the next calendar day in `timeZone` after `from`, plus light jitter
 * so quota-deferred sends don't all fire on the same second.
 * Used when a mailbox daily limit is hit — must match org/mailbox quota day keys
 * (never raw UTC midnight, which is ~evening for US zones).
 */
export function nextZonedDayStartIso(
  from: Date = new Date(),
  timeZone?: string,
): string {
  const zone = resolveOrgTimezone(timeZone, { fallback: "UTC" });
  const nextKey = addUtcDayKey(zonedDayKey(from, zone), 1);
  const start = zonedWallTimeToUtc(nextKey, 0, 0, 0, 0, zone);
  const jitterMs = Math.floor(Math.random() * 5 * 60_000);
  return new Date(start.getTime() + jitterMs).toISOString();
}

/** @deprecated Prefer nextZonedDayStartIso with the org / mailbox timezone. */
export function nextUtcMidnightIso(from = new Date()): string {
  return nextZonedDayStartIso(from, "UTC");
}

export function normalizeSendGapSeconds(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_SEND_GAP_SECONDS;
  const n = Math.floor(value);
  if (n <= 0) return 0;
  return Math.min(SEND_GAP_SECONDS_MAX, Math.max(SEND_GAP_SECONDS_MIN, n));
}
