/**
 * Normalized keys for org-wide duplicate checks (contacts by email, companies by domain).
 */

/** Lowercase trimmed email; returns null if empty or missing @. */
export function normalizeCrmEmailKey(raw: string | undefined | null): string | null {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t || !t.includes("@")) return null;
  return t;
}

/**
 * Normalized hostname for company domain matching (no scheme/path/port, lowercase).
 * Returns null if nothing usable remains.
 */
export function normalizeCrmDomainKey(raw: string | undefined | null): string | null {
  let s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "");
  const slash = s.indexOf("/");
  if (slash >= 0) s = s.slice(0, slash);
  s = s.replace(/^www\./, "");
  const colon = s.indexOf(":");
  if (colon >= 0) s = s.slice(0, colon);
  s = s.trim();
  return s || null;
}

/** Domain part of an email after @, then normalized as a CRM domain key. */
export function domainKeyFromEmail(email: string | undefined | null): string | null {
  const em = normalizeCrmEmailKey(email);
  if (!em) return null;
  const host = em.slice(em.lastIndexOf("@") + 1);
  return normalizeCrmDomainKey(host);
}
