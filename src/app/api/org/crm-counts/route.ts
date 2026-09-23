import { NextResponse } from "next/server";

import { resolveCrmListNarrowForSession } from "@/lib/db/crm-list-scope";
import { countCrmEntitiesInPostgres } from "@/lib/db/list-crm-postgres";
import { countLeadsGroupedInPostgres } from "@/lib/db/list-leads-postgres";
import { isPostgresReadCrmV1Enabled } from "@/lib/db/postgres-read-crm-flags";
import { isPostgresReadLeadsV1Enabled } from "@/lib/db/postgres-read-leads-flags";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";

/**
 * GET /api/org/crm-counts — tenant-scoped entity totals (Phase 4/5 KPI).
 *
 * Narrow scope is derived from session role (members always narrowed); optional
 * `narrow=1` for admins/owners matches paginated list APIs.
 */
export async function GET(req: Request) {
  const guard = await guardTenantApi();
  if (!guard.ok) return guard.response;

  const leadsEnabled = isPostgresReadLeadsV1Enabled();
  const crmEnabled = isPostgresReadCrmV1Enabled();
  if (!leadsEnabled && !crmEnabled) {
    return NextResponse.json({ ok: true, enabled: false, counts: null });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, enabled: true, counts: null, error: "DATABASE_URL is not configured" },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const narrowToMember = await resolveCrmListNarrowForSession(
    guard.ctx.role,
    url.searchParams.get("narrow"),
    guard.ctx.session.uid,
  );
  const organizationId = guard.ctx.session.organizationId;
  const viewerUid = guard.ctx.session.uid;
  const byOwner = url.searchParams.get("byOwner") === "1";
  const byStage = url.searchParams.get("byStage") === "1";

  try {
    const counts = await countCrmEntitiesInPostgres({
      organizationId,
      narrowToMember,
      viewerUid,
    });
    const grouped = leadsEnabled
      ? {
          ...(byOwner
            ? {
                byOwner: await countLeadsGroupedInPostgres(
                  { organizationId, narrowToMember, viewerUid },
                  "ownerId",
                ),
              }
            : {}),
          ...(byStage
            ? {
                byStage: await countLeadsGroupedInPostgres(
                  { organizationId, narrowToMember, viewerUid },
                  "stage",
                ),
              }
            : {}),
        }
      : {};
    return NextResponse.json({
      ok: true,
      enabled: true,
      counts,
      narrow: narrowToMember,
      ...grouped,
    });
  } catch (err) {
    console.error("[org/crm-counts] failed", organizationId, err);
    return NextResponse.json(
      {
        ok: false,
        enabled: true,
        counts: null,
        error: err instanceof Error ? err.message : "Failed to count CRM entities",
      },
      { status: 500 },
    );
  }
}
