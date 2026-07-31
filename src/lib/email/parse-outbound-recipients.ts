/** Loose but practical check for outbound To/Cc lines. */
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Pull a single email from `user@x.com` or `Name <user@x.com>`. */
export function extractEmailAddress(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const angle = trimmed.match(/<([^>]+)>/);
  const candidate = (angle?.[1] ?? trimmed).trim().toLowerCase();
  if (!EMAIL_RE.test(candidate)) return null;
  return candidate;
}

export function normalizeRecipientList(
  raw: string,
  label: "To" | "Cc" | "Bcc" = "To",
): { ok: true; addresses: string[] } | { ok: false; error: string } {
  const parts = raw
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return { ok: false, error: `${label} is required.` };
  }
  const addresses: string[] = [];
  for (const part of parts) {
    const email = extractEmailAddress(part);
    if (!email) {
      const preview = part.length > 48 ? `${part.slice(0, 48)}…` : part;
      return {
        ok: false,
        error: `Invalid ${label} address: “${preview}”. Use a full email like name@company.com.`,
      };
    }
    if (!addresses.includes(email)) addresses.push(email);
  }
  return { ok: true, addresses };
}
