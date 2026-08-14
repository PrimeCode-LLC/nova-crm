import { NextResponse } from "next/server";

import {
  CRM_LIST_MAX_PAGE_SIZE,
  CRM_LIST_PAGE_SIZE,
  listAccountsFromPostgres,
  listAccountsPageFromPostgres,
} from "@/lib/db/list-crm-postgres";
import { isPostgresReadCrmV1Enabled } from "@/lib/db/postgres-read-crm-flags";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";

/**
 * GET /api/org/accounts — feature-flagged Postgres accounts list (P6.1).
 *
 * Query: `narrow=1`, `limit`, `cursor`, `all=1` (same shape as `/api/org/leads`).
 */
export async function GET(req: Request) {
  const guard = await guardTenantApi();
  if (!guard.ok) return guard.response;

  if (!isPostgresReadCrmV1Enabled()) {
    return NextResponse.json({ ok: true, enabled: false, accounts: [], source: null });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        enabled: true,
        accounts: [],
        source: null,
        error: "DATABASE_URL is not configured",
      },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const narrow = url.searchParams.get("narrow") === "1";
  const all = url.searchParams.get("all") === "1";
  const cursor = url.searchParams.get("cursor");
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : CRM_LIST_PAGE_SIZE;
  const organizationId = guard.ctx.session.organizationId;
  const viewerUid = guard.ctx.session.uid;

  try {
    if (all) {
      const accounts = await listAccountsFromPostgres({
        organizationId,
        narrowToMember: narrow,
        viewerUid,
        pageSize: Number.isFinite(limit) ? limit : CRM_LIST_PAGE_SIZE,
      });
      return NextResponse.json({
        ok: true,
        enabled: true,
        accounts,
        source: "postgres" as const,
        count: accounts.length,
        hasMore: false,
        nextCursor: null,
      });
    }

    const page = await listAccountsPageFromPostgres({
      organizationId,
      narrowToMember: narrow,
      viewerUid,
      limit: Number.isFinite(limit) ? Math.min(limit, CRM_LIST_MAX_PAGE_SIZE) : CRM_LIST_PAGE_SIZE,
      cursor,
    });
    return NextResponse.json({
      ok: true,
      enabled: true,
      accounts: page.accounts,
      source: "postgres" as const,
      count: page.accounts.length,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    });
  } catch (err) {
    console.error("[org/accounts] list failed", organizationId, err);
    return NextResponse.json(
      {
        ok: false,
        enabled: true,
        accounts: [],
        source: null,
        error: err instanceof Error ? err.message : "Failed to list accounts",
      },
      { status: 500 },
    );
  }
}
