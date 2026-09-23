import type { Lead } from "@/lib/types";

/** Same ceiling as the leads list walker. Exact company match, then the existing count function. */
const COMPANY_PROSPECT_MAX_PAGES = 40;

/** Page prospects for one company. Stops when the API reports no further rows. */
export async function fetchExactCompanyProspects(base: Record<string, string>): Promise<Lead[]> {
  const rows: Lead[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < COMPANY_PROSPECT_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ ...base, limit: "250" });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`/api/org/leads?${params.toString()}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    const json = (await res.json()) as {
      ok?: boolean;
      leads?: Lead[];
      hasMore?: boolean;
      nextCursor?: string | null;
    };
    if (!res.ok || json.ok === false) break;
    if (Array.isArray(json.leads)) rows.push(...json.leads);
    if (!json.hasMore || !json.nextCursor) break;
    cursor = json.nextCursor;
  }
  return rows;
}
