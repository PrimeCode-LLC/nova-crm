import { NextResponse } from "next/server";

import { parseCrmEntityListFilters } from "@/lib/db/crm-list-filters";
import { resolveCrmListNarrowToMember } from "@/lib/db/crm-list-scope";
import {
  countContactsInPostgres,
  CRM_LIST_MAX_PAGE_SIZE,
  CRM_LIST_PAGE_SIZE,
  listContactsFromPostgres,
  listContactsPageFromPostgres,
} from "@/lib/db/list-crm-postgres";
import { isPostgresReadCrmV1Enabled } from "@/lib/db/postgres-read-crm-flags";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";

/**
 * GET /api/org/contacts — feature-flagged Postgres contacts list (P6.1).
 *
 * Query: `narrow=1`, `limit`, `cursor`, `all=1` (same shape as `/api/org/leads`).
 */
export async function GET(req: Request) {
  const guard = await guardTenantApi();
  if (!guard.ok) return guard.response;

  if (!isPostgresReadCrmV1Enabled()) {
    return NextResponse.json({ ok: true, enabled: false, contacts: [], source: null });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        enabled: true,
        contacts: [],
        source: null,
        error: "DATABASE_URL is not configured",
      },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const narrowToMember = resolveCrmListNarrowToMember(
    guard.ctx.role,
    url.searchParams.get("narrow"),
  );
  const all = url.searchParams.get("all") === "1";
  const countOnly = url.searchParams.get("countOnly") === "1";
  const cursor = url.searchParams.get("cursor");
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : CRM_LIST_PAGE_SIZE;
  const filters = parseCrmEntityListFilters(url);
  const organizationId = guard.ctx.session.organizationId;
  const viewerUid = guard.ctx.session.uid;
  const listOpts = { organizationId, narrowToMember, viewerUid, filters };

  try {
    if (countOnly) {
      const totalCount = await countContactsInPostgres(listOpts);
      return NextResponse.json({
        ok: true,
        enabled: true,
        source: "postgres" as const,
        totalCount,
        narrow: narrowToMember,
      });
    }

    if (all) {
      const contacts = await listContactsFromPostgres({
        ...listOpts,
        pageSize: Number.isFinite(limit) ? limit : CRM_LIST_PAGE_SIZE,
      });
      return NextResponse.json({
        ok: true,
        enabled: true,
        contacts,
        source: "postgres" as const,
        count: contacts.length,
        hasMore: false,
        nextCursor: null,
      });
    }

    const page = await listContactsPageFromPostgres({
      ...listOpts,
      limit: Number.isFinite(limit) ? Math.min(limit, CRM_LIST_MAX_PAGE_SIZE) : CRM_LIST_PAGE_SIZE,
      cursor,
    });
    return NextResponse.json({
      ok: true,
      enabled: true,
      contacts: page.contacts,
      source: "postgres" as const,
      count: page.contacts.length,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    });
  } catch (err) {
    console.error("[org/contacts] list failed", organizationId, err);
    return NextResponse.json(
      {
        ok: false,
        enabled: true,
        contacts: [],
        source: null,
        error: err instanceof Error ? err.message : "Failed to list contacts",
      },
      { status: 500 },
    );
  }
}
