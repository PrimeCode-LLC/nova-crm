const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Stockholm",
  "Europe/Dublin",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  "UTC",
] as const;

export function buildTimezoneOptions(current?: string): string[] {
  const browser =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tz of [current, browser, ...COMMON_TIMEZONES]) {
    if (!tz || seen.has(tz)) continue;
    seen.add(tz);
    out.push(tz);
  }
  return out;
}

export function formatTimezoneLabel(tz: string): string {
  return tz.replace(/_/g, " ");
}

/** IANA zone from the current browser (e.g. Asia/Karachi). */
export function getBrowserTimezone(): string {
  if (typeof Intl === "undefined") return "UTC";
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * Human label for the browser local zone used by `datetime-local` pickers,
 * e.g. "Asia/Karachi (PKT)" or "America/New York (EST)".
 */
export function formatBrowserTimezoneLabel(at: Date = new Date()): string {
  const tz = getBrowserTimezone();
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
