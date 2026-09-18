import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { isDashboardKpiApiV2Enabled } from "@/lib/dashboard-kpi-v2-flags";
import { listLeadsFromPostgres } from "@/lib/db/list-leads-postgres";
import { scopeDashboardEntitiesForKpiViewer } from "@/lib/dashboard-kpi-scope";
import { listOrgUsersServer } from "@/lib/platform/hierarchy-access-server";
import { enrichLeadsIdleState } from "@/lib/lead-idle";
import { hasPendingReplyReview } from "@/lib/leads/reply-review";
import { isSalesLead } from "@/lib/dashboard-workflow";

/**
 * Phase 5 — top-N dashboard list widgets (idle leads / reply reviews).
 * Query: kind=idle|reply-reviews&limit=6
 */
export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  if (!isDashboardKpiApiV2Enabled()) {
    return NextResponse.json({ ok: true, enabled: false, rows: [] });
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind")?.trim() || "idle";
  const limitRaw = Number(url.searchParams.get("limit") ?? "6");
  const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 6));
  const orgId = g.ctx.session.organizationId;

  const [allLeads, users] = await Promise.all([
    listLeadsFromPostgres({ organizationId: orgId }),
    listOrgUsersServer(orgId),
  ]);
  const viewer = users.find((u) => u.id === g.ctx.session.uid);
  if (!viewer) {
    return NextResponse.json({ error: "Viewer not found in org roster" }, { status: 403 });
  }

  // Widgets must respect hierarchy visibility — never return the full tenant to a member.
  const leads = enrichLeadsIdleState(
    scopeDashboardEntitiesForKpiViewer({
      viewer,
      orgUsers: users,
      leads: allLeads,
      deals: [],
      followups: [],
      leadTasks: [],
    }).leads,
  );

  if (kind === "reply-reviews") {
    const rows = leads
      .filter(hasPendingReplyReview)
      .slice(0, limit)
      .map((l) => ({
        id: l.id,
        contactName: l.contactName,
        companyName: l.companyName,
        stage: l.stage,
        ownerId: l.ownerId,
      }));
    return NextResponse.json({ ok: true, enabled: true, kind, rows });
  }

  const rows = leads
    .filter((l) => isSalesLead(l) && l.isIdle && !["won", "lost"].includes(l.stage))
    .sort((a, b) => (b.idleDays ?? 0) - (a.idleDays ?? 0))
    .slice(0, limit)
    .map((l) => ({
      id: l.id,
      contactName: l.contactName,
      companyName: l.companyName,
      stage: l.stage,
      ownerId: l.ownerId,
      idleDays: l.idleDays ?? 0,
    }));
  return NextResponse.json({ ok: true, enabled: true, kind: "idle", rows });
}
