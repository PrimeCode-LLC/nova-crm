/**
 * P3.4 — notify App Hosting to recompute Postgres `org_dashboard_summaries`
 * after lead/deal/followup writes (replaces Firestore orgDashboardSummaries writes).
 */

import { defineString } from "firebase-functions/params";
import { cronSecret, siteUrl } from "./siteParams";

export { cronSecret, siteUrl };

/**
 * Where Cloud Functions persist org dashboard KPI summaries after lead/deal/followup writes.
 * - postgres (default, P3.4): POST App Hosting recompute-org (Postgres SoT)
 * - firestore: legacy write to `orgDashboardSummaries` only
 * - dual: Firestore write + App Hosting Postgres recompute
 */
export const orgDashboardSummaryStore = defineString("ORG_DASHBOARD_SUMMARY_STORE", {
  default: "postgres",
  description: "postgres | firestore | dual — org dashboard summary system of record",
});

export function normalizeOrgDashboardSummaryStore(
  raw: string | undefined,
): "postgres" | "firestore" | "dual" {
  const v = (raw ?? "postgres").trim().toLowerCase();
  if (v === "firestore" || v === "dual") return v;
  return "postgres";
}

/** Force-refresh one org's Postgres dashboard summary via App Hosting (Bearer CRON_SECRET). */
export async function notifyAppHostingOrgDashboardSummaryRecompute(
  organizationId: string,
): Promise<void> {
  const orgId = organizationId.trim();
  if (!orgId) return;

  const base = siteUrl.value().replace(/\/$/, "");
  const secret = cronSecret.value()?.trim();
  if (!secret) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "org dashboard PG notify skipped: CRON_SECRET missing",
        organizationId: orgId,
      }),
    );
    return;
  }

  const res = await fetch(`${base}/api/cron/dashboard-summaries/recompute-org`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ organizationId: orgId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `App Hosting org dashboard recompute failed (${res.status}): ${text.slice(0, 400)}`,
    );
  }
}
