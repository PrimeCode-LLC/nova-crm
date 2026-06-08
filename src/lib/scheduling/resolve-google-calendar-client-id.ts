/** Public OAuth client id for calendar-only GIS (safe on the client). */
export function resolvePublicGoogleCalendarClientId(
  fromContext?: string | null,
): string | null {
  const fromEnv = process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID?.trim();
  if (fromEnv) return fromEnv;
  const fromApi = fromContext?.trim();
  return fromApi || null;
}
