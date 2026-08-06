import { resolveOrgTimezone, todayDateInputInZone, zonedDayKey } from "@/lib/org-timezone";

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const DATE_TOKEN =
  "(?<y4>\\d{4})[-/.](?<m4>\\d{1,2})[-/.](?<d4>\\d{1,2})" +
  "|(?<m1>\\d{1,2})[/.-](?<d1>\\d{1,2})(?:[/.-](?<y1>\\d{2,4}))?" +
  "|(?<mon>[A-Za-z]{3,9})\\s+(?<d2>\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(?<y2>\\d{2,4}))?" +
  "|(?<d3>\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?<mon2>[A-Za-z]{3,9})(?:,?\\s*(?<y3>\\d{2,4}))?";

/**
 * Phrases that usually mean "I am back on / after this day".
 * Kept tight so random dates in signatures do not become waitUntil.
 */
const RETURN_CUE =
  /(?:(?:back|return(?:ing)?|available|in(?:\s+the)?\s+office|reach(?:able)?)\s+(?:on|by|after|from)|(?:until|till|through)\s+(?:the\s+)?|(?:out|away|ooo|leave|vacation|holiday)\s+(?:until|till|through)\s+(?:the\s+)?|resume(?:s|d)?\s+(?:on|from)\s+)/i;

/** YYYY-MM-DD when valid; otherwise null. */
export function normalizeWaitUntilDate(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [ys, ms, ds] = raw.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }
  return raw;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function resolveYear(raw: string | undefined, month: number, day: number, todayYmd: string): number {
  const [ty, tm, td] = todayYmd.split("-").map(Number);
  if (raw) {
    const n = Number(raw);
    if (n >= 100) return n;
    if (n >= 0 && n <= 99) return 2000 + n;
  }
  // Bare month/day: assume this year, roll to next year if already past.
  const candidate = `${ty}-${pad2(month)}-${pad2(day)}`;
  if (candidate < todayYmd) return (ty ?? new Date().getUTCFullYear()) + 1;
  return ty ?? new Date().getUTCFullYear();
}

function fromMatch(
  match: RegExpMatchArray,
  todayYmd: string,
): string | null {
  const g = match.groups ?? {};
  let year: number;
  let month: number;
  let day: number;

  if (g.y4 && g.m4 && g.d4) {
    year = Number(g.y4);
    month = Number(g.m4);
    day = Number(g.d4);
  } else if (g.m1 && g.d1) {
    let a = Number(g.m1);
    let b = Number(g.d1);
    // When the first number can't be a month, treat as D/M (common outside the US).
    if (a > 12 && b >= 1 && b <= 12) {
      month = b;
      day = a;
    } else {
      month = a;
      day = b;
    }
    year = resolveYear(g.y1, month, day, todayYmd);
  } else if (g.mon && g.d2) {
    month = MONTHS[g.mon.toLowerCase()] ?? 0;
    day = Number(g.d2);
    year = resolveYear(g.y2, month, day, todayYmd);
  } else if (g.d3 && g.mon2) {
    month = MONTHS[g.mon2.toLowerCase()] ?? 0;
    day = Number(g.d3);
    year = resolveYear(g.y3, month, day, todayYmd);
  } else {
    return null;
  }

  return normalizeWaitUntilDate(`${year}-${pad2(month)}-${pad2(day)}`);
}

/**
 * Pull a return / "back on" calendar day from an OOO body.
 * Returns YYYY-MM-DD in the org calendar, or null when nothing reliable is found.
 */
export function parseOooReturnDate(
  text: string,
  options?: { today?: string; timeZone?: string },
): string | null {
  const zone = resolveOrgTimezone(options?.timeZone);
  const todayYmd =
    normalizeWaitUntilDate(options?.today) ?? todayDateInputInZone(zone);
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  const cueRe = new RegExp(`${RETURN_CUE.source}(?:${DATE_TOKEN})`, "i");
  const cueHit = cleaned.match(cueRe);
  if (cueHit) {
    const date = fromMatch(cueHit, todayYmd);
    if (date && date >= todayYmd) return date;
  }

  // Fallback: first future-looking date near "back"/"until" within a short window.
  const loose = new RegExp(DATE_TOKEN, "gi");
  let m: RegExpExecArray | null;
  while ((m = loose.exec(cleaned))) {
    const start = Math.max(0, m.index - 40);
    const window = cleaned.slice(start, m.index + m[0].length);
    if (!RETURN_CUE.test(window) && !/\buntil\b|\btill\b|\bback\b|\breturn/i.test(window)) {
      continue;
    }
    const date = fromMatch(m, todayYmd);
    if (date && date >= todayYmd) return date;
  }
  return null;
}

/**
 * Prefer the AI's structured date; fall back to a heuristic parse of the body / summary.
 */
export function resolveWaitUntilDate(input: {
  aiWaitUntilDate?: string | null;
  subject?: string;
  body?: string;
  nextStepSummary?: string;
  today?: string;
  timeZone?: string;
}): string | null {
  const fromAi = normalizeWaitUntilDate(input.aiWaitUntilDate);
  if (fromAi) return fromAi;
  const blob = [input.subject, input.body, input.nextStepSummary].filter(Boolean).join("\n");
  return parseOooReturnDate(blob, { today: input.today, timeZone: input.timeZone });
}

/**
 * Cadence start for sequence due dates / schedule defaults.
 * When `followUpAfterDate` is today or in the future, start there; otherwise today.
 */
export function sequenceCadenceStartFromWaitUntil(input: {
  followUpAfterDate?: string | null;
  timeZone?: string;
  now?: Date;
}): Date {
  const zone = resolveOrgTimezone(input.timeZone);
  const now = input.now ?? new Date();
  const today = zonedDayKey(now, zone);
  const wait = normalizeWaitUntilDate(input.followUpAfterDate);
  const startKey = wait && wait >= today ? wait : today;
  return new Date(`${startKey}T12:00:00.000Z`);
}

/** True when the lead still has a future wait-until date from an auto-reply / deferral. */
export function hasActiveFollowUpAfterDate(
  followUpAfterDate: string | null | undefined,
  timeZone?: string,
  now?: Date,
): boolean {
  const zone = resolveOrgTimezone(timeZone);
  const today = zonedDayKey(now ?? new Date(), zone);
  const wait = normalizeWaitUntilDate(followUpAfterDate);
  return Boolean(wait && wait >= today);
}
