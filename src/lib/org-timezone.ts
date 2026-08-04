/**
 * Organization / browser timezone resolution and zoned calendar helpers.
 * Prefer IANA zones (e.g. America/New_York). Absolute instants stay ISO UTC in storage.
 */

export function isValidIanaTimezone(tz: string): boolean {
  const value = tz.trim();
  if (!value) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Browser IANA zone, or UTC when Intl is unavailable. */
export function getBrowserTimezone(): string {
  if (typeof Intl === "undefined") return "UTC";
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * Resolve effective timezone: sticky org setting when set, else browser (client)
 * or UTC (server last resort when no hint is provided).
 */
export function resolveOrgTimezone(
  orgTimezone?: string | null,
  options?: { fallback?: string },
): string {
  const org = orgTimezone?.trim();
  if (org && isValidIanaTimezone(org)) return org;
  const fallback = options?.fallback?.trim();
  if (fallback && isValidIanaTimezone(fallback)) return fallback;
  if (typeof Intl !== "undefined") {
    const browser = getBrowserTimezone();
    if (browser) return browser;
  }
  return "UTC";
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
  };
}

/** Calendar day key (YYYY-MM-DD) in the given zone. */
export function zonedDayKey(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/**
 * UTC instant for a wall-clock date/time in `timeZone`.
 * Iteratively corrects for DST / offset (no date-fns-tz dependency).
 */
export function zonedWallTimeToUtc(
  ymd: string,
  hour: number,
  minute: number,
  second = 0,
  ms = 0,
  timeZone: string,
): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!match) return new Date(NaN);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  let utc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  for (let i = 0; i < 4; i++) {
    const parts = getZonedParts(new Date(utc), timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      ms,
    );
    const desired = Date.UTC(year, month - 1, day, hour, minute, second, ms);
    const delta = desired - asUtc;
    if (delta === 0) break;
    utc += delta;
  }
  return new Date(utc);
}

export function startOfZonedDay(date: Date, timeZone: string): Date {
  return zonedWallTimeToUtc(zonedDayKey(date, timeZone), 0, 0, 0, 0, timeZone);
}

export function endOfZonedDay(date: Date, timeZone: string): Date {
  return zonedWallTimeToUtc(zonedDayKey(date, timeZone), 23, 59, 59, 999, timeZone);
}

/** Noon in zone for a YYYY-MM-DD date input (follow-up due dates). */
export function isoFromDateInputInZone(dateStr: string, timeZone: string): string {
  const d = zonedWallTimeToUtc(dateStr.trim(), 12, 0, 0, 0, timeZone);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Today as YYYY-MM-DD in the given zone. */
export function todayDateInputInZone(timeZone: string, now: Date = new Date()): string {
  return zonedDayKey(now, timeZone);
}

/**
 * Parse `datetime-local` value (`YYYY-MM-DDTHH:mm`) as wall clock in `timeZone` → ISO UTC.
 * When `timeZone` is the browser zone this matches `new Date(value)`.
 */
export function isoFromDatetimeLocalInZone(value: string, timeZone: string): string {
  const trimmed = value.trim();
  const [datePart, timePart = "00:00"] = trimmed.split("T");
  if (!datePart) return new Date().toISOString();
  const [hRaw, mRaw = "0"] = timePart.split(":");
  const hour = Number(hRaw);
  const minute = Number(mRaw);
  const d = zonedWallTimeToUtc(
    datePart,
    Number.isFinite(hour) ? hour : 0,
    Number.isFinite(minute) ? minute : 0,
    0,
    0,
    timeZone,
  );
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Format an instant as `datetime-local` wall clock in `timeZone`. */
export function datetimeLocalInZone(isoOrDate: string | Date, timeZone: string): string {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(date.getTime())) return "";
  const p = getZonedParts(date, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}`;
}

/**
 * Absolute instant rendered as wall clock in `timeZone`, e.g. `Aug 4, 9:00 AM EDT`.
 * Scheduled sends must use this instead of a bare date-fns `format()`, which would
 * silently render the viewer's own clock and misreport the real send time.
 */
export function formatInstantInZone(
  isoOrDate: string | Date,
  timeZone?: string,
  options?: { year?: boolean; zoneAbbr?: boolean },
): string {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(date.getTime())) return "";
  const zone = resolveOrgTimezone(timeZone);
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      month: "short",
      day: "numeric",
      ...(options?.year ? { year: "numeric" as const } : {}),
      hour: "numeric",
      minute: "2-digit",
      ...(options?.zoneAbbr === false ? {} : { timeZoneName: "short" as const }),
    }).format(date);
  } catch {
    return "";
  }
}

export function formatTimezoneLabel(tz: string): string {
  return tz.replace(/_/g, " ");
}

/** e.g. "America/New York (EST)" */
export function formatTimezoneDisplayLabel(tz: string, at: Date = new Date()): string {
  const name = formatTimezoneLabel(tz);
  let short = "";
  try {
    short =
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        timeZoneName: "short",
      })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    /* ignore */
  }
  if (short && short !== name && !name.includes(short)) {
    return `${name} (${short})`;
  }
  return name;
}
