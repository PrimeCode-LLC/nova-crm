import type { Lead } from "@/lib/types";

/** Human-readable label for a lead row (contact + company). */
export function leadDisplayLabel(
  lead: Pick<Lead, "contactName" | "companyName"> | { contactName?: string; companyName?: string },
): string {
  const name = lead.contactName?.trim() || "Contact";
  const company = lead.companyName?.trim();
  return company ? `${name} (${company})` : name;
}

/** First name from a contact display name - useful for compact dashboard / wall rows. */
export function contactFirstName(contactName?: string | null): string | undefined {
  const trimmed = contactName?.trim();
  if (!trimmed) return undefined;
  return trimmed.split(/\s+/)[0] || undefined;
}

/**
 * Company (preferred) or contact for the primary entity line.
 * Pair with `contactFirstName` when you want who to reach out to on a second line.
 */
export function leadEntityLabel(
  lead: Pick<Lead, "contactName" | "companyName"> | { contactName?: string; companyName?: string } | undefined,
  fallback = "Unlinked item",
): string {
  if (!lead) return fallback;
  return lead.companyName?.trim() || lead.contactName?.trim() || fallback;
}

const LEAD_DETAIL_PATH = /^\/(?:leads|prospects)\/([^/?#]+)$/;

export function leadIdFromPath(path: string): string | null {
  const m = path.trim().match(LEAD_DETAIL_PATH);
  return m?.[1] ?? null;
}
