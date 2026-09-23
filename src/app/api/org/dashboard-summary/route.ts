import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { isDashboardSummariesV1Enabled } from "@/lib/dashboard-summary-flags";
import { getOrgDashboardSummaryServer } from "@/lib/dashboard-summary-server";
import { getPersonDashboardTaskGaugesServer } from "@/lib/dashboard-person-summary-server";
import { isPostgresDashboardSummaryReadEnabled } from "@/lib/db/postgres-dashboard-summary-flags";
import { getOrgDashboardSummaryFromPostgres } from "@/lib/db/org-dashboard-summary-read";
import { getDocument } from "@/lib/db/document-shim/store";
import { COLLECTIONS } from "@/lib/documents/collections";
import { defaultCrmRoleIdForOrgRole } from "@/lib/platform/crm-role-defaults";
import { resolveDashboardKpiViewer } from "@/lib/dashboard-kpi-scope";
import { resolveSafePreviewRole } from "@/lib/dashboard-kpis-server";
import { seesAllLeadsInTenant } from "@/lib/workspace-hierarchy";
import type { Role, User } from "@/lib/types";

const PREVIEW_ROLES = new Set<Role>([
  "director",
  "manager",
  "team_lead",
  "salesperson",
  "content_team",
]);

/**
 * P0.6 / P3.3 / P3.4 — read org dashboard summary + person task gauges.
 *
 * Enablement: Phase 3 Postgres read and/or Phase 0 Firestore read (rollback).
 * P3.4: when Postgres read is on, Postgres is sole source (no Firestore fallback).
 */
export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const pgRead = isPostgresDashboardSummaryReadEnabled();
  const fsRead = isDashboardSummariesV1Enabled();
  if (!pgRead && !fsRead) {
    return NextResponse.json({
      ok: true,
      enabled: false,
      summary: null,
      person: null,
      source: null,
    });
  }

  const orgId = g.ctx.session.organizationId;
  const uid = g.ctx.session.uid;
  const previewRaw = new URL(req.url).searchParams.get("previewRole")?.trim() || "";
  const requestedPreview =
    previewRaw && PREVIEW_ROLES.has(previewRaw as Role) ? (previewRaw as Role) : null;
  const userDoc = await getDocument(`${COLLECTIONS.users}/${uid}`);
  const roleId =
    typeof userDoc?.payload.roleId === "string"
      ? (userDoc.payload.roleId as Role)
      : defaultCrmRoleIdForOrgRole(g.ctx.role);
  const viewer: User = {
    id: uid,
    email: g.ctx.session.email ?? "",
    displayName: g.ctx.session.name ?? uid,
    roleId,
    isSuperAdmin: userDoc?.payload.isSuperAdmin === true,
    orgRole: g.ctx.role,
    status: "active",
    createdAt: new Date(0).toISOString(),
  };
  const safePreview = resolveSafePreviewRole(viewer, requestedPreview);
  const effective = resolveDashboardKpiViewer(viewer, safePreview) ?? viewer;
  // Person gauges stay the signed-in user. Org summary is withheld when preview narrows.
  const includeOrgSummary = seesAllLeadsInTenant(effective);

  const [summaryResult, personResult] = await Promise.all([
    (async () => {
      if (pgRead) {
        // P3.4 — Postgres is SoT; do not fall back to Firestore.
        return getOrgDashboardSummaryFromPostgres(orgId);
      }
      return getOrgDashboardSummaryServer(orgId);
    })(),
    getPersonDashboardTaskGaugesServer(orgId, uid),
  ]);

  if (!summaryResult || !includeOrgSummary) {
    return NextResponse.json({
      ok: true,
      enabled: true,
      summary: null,
      person: personResult?.gauges ?? null,
      personSource: personResult?.source ?? null,
      source: null,
      previewRole: safePreview,
    });
  }

  return NextResponse.json({
    ok: true,
    enabled: true,
    summary: summaryResult.summary,
    source: summaryResult.source,
    person: personResult?.gauges ?? null,
    personSource: personResult?.source ?? null,
    previewRole: safePreview,
  });
}
