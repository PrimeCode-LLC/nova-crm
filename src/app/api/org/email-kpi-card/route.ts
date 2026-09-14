import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  isDashboardTimeRangeKey,
  getDashboardRangeStart,
  type DashboardTimeRangeKey,
} from "@/lib/dashboard-date-range";
import { resolveEmailKpiSenderIds } from "@/lib/dashboard-email-kpi-card";
import { loadEmailKpiLiveSliceFromServer } from "@/lib/dashboard-email-kpi-card-server";
import { listOrgUsersServer } from "@/lib/platform/hierarchy-access-server";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { User } from "@/lib/types";
import { resolveOrgTimezone } from "@/lib/org-timezone";
import type { DocumentData } from "@/lib/db/document-shim/shim-firestore";

const querySchema = z.object({
  range: z.string().min(1),
  ownerScope: z.string().min(1).default("all-owners"),
  timeZone: z.string().optional(),
});

function asUserMinimal(id: string, raw: DocumentData): User {
  const r = raw as Record<string, unknown>;
  return {
    id,
    email: String(r.email ?? ""),
    displayName: String(r.displayName ?? r.email ?? id),
    roleId: (r.roleId as User["roleId"]) ?? "salesperson",
    managerId: typeof r.managerId === "string" ? r.managerId : undefined,
    isSuperAdmin: Boolean(r.isSuperAdmin),
    organizationId: typeof r.organizationId === "string" ? r.organizationId : undefined,
    orgRole: r.orgRole as User["orgRole"],
    status: (r.status as User["status"]) ?? "active",
    createdAt: "",
  };
}

/**
 * Live Emails KPI card slice — compose sends + opens-by-sender for the selected range/scope.
 * Read-only. Used only by the dashboard Emails pulse tile.
 */
export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    range: url.searchParams.get("range") ?? "30d",
    ownerScope: url.searchParams.get("ownerScope") ?? "all-owners",
    timeZone: url.searchParams.get("timeZone") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid query" }, { status: 400 });
  }
  if (!isDashboardTimeRangeKey(parsed.data.range)) {
    return NextResponse.json({ ok: false, error: "Invalid range" }, { status: 400 });
  }
  const range = parsed.data.range as DashboardTimeRangeKey;
  const ownerScope = parsed.data.ownerScope;
  const orgId = g.ctx.session.organizationId;
  const uid = g.ctx.session.uid;

  const orgUsers = await listOrgUsersServer(orgId);
  let viewer = orgUsers.find((u) => u.id === uid) ?? null;
  if (!viewer) {
    const db = getAdminDb();
    if (db) {
      try {
        const snap = await db.collection(COLLECTIONS.users).doc(uid).get();
        if (snap.exists) viewer = asUserMinimal(snap.id, snap.data()!);
      } catch {
        /* fall through */
      }
    }
  }
  if (!viewer) {
    viewer = {
      id: uid,
      email: g.ctx.session.email ?? "",
      displayName: g.ctx.session.name ?? uid,
      roleId: "salesperson",
      orgRole: g.ctx.role,
      status: "active",
      organizationId: orgId,
      createdAt: "",
    };
  }
  // Session org role is authoritative for admin/owner elevation when CRM doc lags.
  if (g.ctx.role === "owner" || g.ctx.role === "admin") {
    viewer = { ...viewer, orgRole: g.ctx.role };
  }

  const senderIds = resolveEmailKpiSenderIds({
    viewer,
    orgUsers,
    ownerScope,
  });

  const timeZone = resolveOrgTimezone(parsed.data.timeZone);
  const rangeStartMs = getDashboardRangeStart(range, { timeZone }).getTime();

  const live = await loadEmailKpiLiveSliceFromServer({
    organizationId: orgId,
    rangeStartMs,
    senderIds,
  });

  return NextResponse.json({
    ok: true,
    range,
    ownerScope,
    composeSentInRange: live.composeSentInRange,
    opensInRange: live.opensInRange,
  });
}
