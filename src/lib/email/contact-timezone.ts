/**
 * Derive a likely IANA timezone from country code / phone when Contact.timezone is unset.
 */

const COUNTRY_TIMEZONE: Record<string, string> = {
  US: "America/New_York",
  CA: "America/Toronto",
  GB: "Europe/London",
  UK: "Europe/London",
  AU: "Australia/Sydney",
  NZ: "Pacific/Auckland",
  DE: "Europe/Berlin",
  FR: "Europe/Paris",
  ES: "Europe/Madrid",
  IT: "Europe/Rome",
  NL: "Europe/Amsterdam",
  BE: "Europe/Brussels",
  SE: "Europe/Stockholm",
  NO: "Europe/Oslo",
  DK: "Europe/Copenhagen",
  FI: "Europe/Helsinki",
  PL: "Europe/Warsaw",
  PT: "Europe/Lisbon",
  IE: "Europe/Dublin",
  CH: "Europe/Zurich",
  AT: "Europe/Vienna",
  IN: "Asia/Kolkata",
  PK: "Asia/Karachi",
  BD: "Asia/Dhaka",
  AE: "Asia/Dubai",
  SA: "Asia/Riyadh",
  SG: "Asia/Singapore",
  MY: "Asia/Kuala_Lumpur",
  JP: "Asia/Tokyo",
  KR: "Asia/Seoul",
  CN: "Asia/Shanghai",
  HK: "Asia/Hong_Kong",
  TW: "Asia/Taipei",
  BR: "America/Sao_Paulo",
  MX: "America/Mexico_City",
  AR: "America/Argentina/Buenos_Aires",
  CL: "America/Santiago",
  CO: "America/Bogota",
  ZA: "Africa/Johannesburg",
  NG: "Africa/Lagos",
  KE: "Africa/Nairobi",
  EG: "Africa/Cairo",
  IL: "Asia/Jerusalem",
  TR: "Europe/Istanbul",
  RU: "Europe/Moscow",
};

const PHONE_PREFIX_COUNTRY: Array<{ prefix: string; country: string }> = [
  { prefix: "1", country: "US" },
  { prefix: "44", country: "GB" },
  { prefix: "61", country: "AU" },
  { prefix: "64", country: "NZ" },
  { prefix: "49", country: "DE" },
  { prefix: "33", country: "FR" },
  { prefix: "34", country: "ES" },
  { prefix: "39", country: "IT" },
  { prefix: "31", country: "NL" },
  { prefix: "91", country: "IN" },
  { prefix: "92", country: "PK" },
  { prefix: "971", country: "AE" },
  { prefix: "65", country: "SG" },
  { prefix: "81", country: "JP" },
  { prefix: "82", country: "KR" },
  { prefix: "86", country: "CN" },
  { prefix: "55", country: "BR" },
  { prefix: "52", country: "MX" },
];

export function timezoneFromCountryCode(country?: string | null): string | undefined {
  const key = country?.trim().toUpperCase();
  if (!key) return undefined;
  return COUNTRY_TIMEZONE[key];
}

export function countryFromPhone(phone?: string | null): string | undefined {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return undefined;
  const normalized = digits.startsWith("00") ? digits.slice(2) : digits;
  const sorted = [...PHONE_PREFIX_COUNTRY].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const row of sorted) {
    if (normalized.startsWith(row.prefix)) return row.country;
  }
  return undefined;
}

/** Prefer explicit timezone, else country, else phone-derived country. */
export function deriveContactTimezone(input: {
  timezone?: string | null;
  country?: string | null;
  phone?: string | null;
}): string | undefined {
  const explicit = input.timezone?.trim();
  if (explicit) return explicit;
  const fromCountry = timezoneFromCountryCode(input.country);
  if (fromCountry) return fromCountry;
  return timezoneFromCountryCode(countryFromPhone(input.phone));
}
