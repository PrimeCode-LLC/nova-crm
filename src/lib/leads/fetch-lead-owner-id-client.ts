"use client";

/**
 * Resolve a lead's `ownerId` from Postgres when the workspace snapshot does not
 * include the row (Phase 4 — timeline / persist owner scoping).
 */
export async function fetchLeadOwnerIdClient(leadId: string): Promise<string> {
  const id = leadId.trim();
  if (!id) return "";
  try {
    const res = await fetch(`/api/org/leads/${encodeURIComponent(id)}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { ok?: boolean; lead?: { ownerId?: string } };
    if (data.ok === false || !data.lead) return "";
    return data.lead.ownerId?.trim() ?? "";
  } catch {
    return "";
  }
}
