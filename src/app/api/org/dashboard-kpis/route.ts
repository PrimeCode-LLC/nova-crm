import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { isDashboardKpiApiV2Enabled } from "@/lib/dashboard-kpi-v2-flags";
import { getDashboardKpisServer } from "@/lib/dashboard-kpis-server";
import { listOrgUsersServer } from "@/lib/platform/hierarchy-access-server";
import { parseDashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import type { Role } from "@/lib/types";

const PREVIEW_ROLES = new Set<Role>([
  "director",
  "manager",
  "team_lead",
  "salesperson",
  "content_team",
]);

/**
 * Phase 2 — scoped dashboard KPI aggregates only (no CRM rows).
 * Query: channels (csv), ownerScope, range, previewRole, bypassCache=1
 */
export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  if (!isDashboardKpiApiV2Enabled()) {
    return NextResponse.json({
      ok: true,
      enabled: false,
      payload: null,
    });
  }

  const url = new URL(req.url);
  const orgId = g.ctx.session.organizationId;
  const uid = g.ctx.session.uid;
  const channelsRaw = url.searchParams.get("channels")?.trim() ?? "";
  const channels = channelsRaw
    ? channelsRaw.split(",").map((c) => c.trim()).filter(Boolean)
    : [];
  const ownerScope = url.searchParams.get("ownerScope")?.trim() || "all-owners";
  const range = parseDashboardTimeRangeKey(url.searchParams.get("range"), "30d");
  const previewRaw = url.searchParams.get("previewRole")?.trim() || "";
  const previewRole =
    previewRaw && PREVIEW_ROLES.has(previewRaw as Role)
      ? (previewRaw as Role)
      : null;
  const bypassCache = url.searchParams.get("bypassCache") === "1";

  const users = await listOrgUsersServer(orgId);
  const viewer = users.find((u) => u.id === uid);
  if (!viewer) {
    return NextResponse.json({ error: "Viewer not found in org roster" }, { status: 403 });
  }

  try {
    const payload = await getDashboardKpisServer({
      organizationId: orgId,
      viewer,
      sessionUid: uid,
      channels,
      ownerScope,
      range,
      previewRole,
      bypassCache,
    });
    return NextResponse.json({ ok: true, enabled: true, payload });
  } catch (err) {
    console.error("[dashboard-kpis]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to compute KPIs" },
      { status: 500 },
    );
  }
}
