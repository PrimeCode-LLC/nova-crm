import type { Lead } from "@/lib/types";

/** Human-readable label for a lead row (contact + company). */
export function leadDisplayLabel(
  lead: Pick<Lead, "contactName" | "companyName"> | { contactName?: string; companyName?: string },
): string {
  const name = lead.contactName?.trim() || "Contact";
  const company = lead.companyName?.trim();
  return company ? `${name} (${company})` : name;
}

const LEAD_DETAIL_PATH = /^\/(?:leads|prospects)\/([^/?#]+)$/;

export function leadIdFromPath(path: string): string | null {
  const m = path.trim().match(LEAD_DETAIL_PATH);
  return m?.[1] ?? null;
}
