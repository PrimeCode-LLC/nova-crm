import { NextResponse } from "next/server";

import { parseLeadListFilters } from "@/lib/db/crm-list-filters";
import { resolveCrmListNarrowForSession } from "@/lib/db/crm-list-scope";
import {
  countLeadsInPostgres,
  LEADS_LIST_MAX_PAGE_SIZE,
  LEADS_LIST_PAGE_SIZE,
  listLeadsFromPostgres,
  listLeadsPageFromPostgres,
} from "@/lib/db/list-leads-postgres";
import { isPostgresReadLeadsV1Enabled } from "@/lib/db/postgres-read-leads-flags";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { countCompanyProspectsForActor } from "@/lib/prospects/count-company-prospects-server";

/**
 * GET /api/org/leads — feature-flagged Postgres leads list (P2.10).
 *
 * Query:
 * - `narrow=1` — member-scope slices (owner / manager / assignee / shared)
 * - `limit` — page size (default 250, max 500); ignored when `all=1`
 * - `cursor` — opaque pagination cursor from a previous page
 * - `all=1` — walk pages server-side into one snapshot (workspace poll; still capped)
 * - `q`, `stage`, `channel`, `ownerId`, `intakeKind`, `activeOnly`, `archivedOnly`, `isIdle` — server filters
 * - `replyReviewStatus`, `replyActionStatus` — payload equals; superset of the client predicates
 * - `companyNameExact` — company column equals (skips `q` on that column); `companyDomain` — payload equals
 * - `countOnly=1` — total matching rows (same scope/filters, no page body)
 *
 * When the flag is off, returns `{ enabled: false }` so clients keep Firestore.
 */
export async function GET(req: Request) {
  const guard = await guardTenantApi();
  if (!guard.ok) return guard.response;

  if (!isPostgresReadLeadsV1Enabled()) {
    return NextResponse.json({ ok: true, enabled: false, leads: [], source: null });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, enabled: true, leads: [], source: null, error: "DATABASE_URL is not configured" },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const narrowToMember = await resolveCrmListNarrowForSession(
    guard.ctx.role,
    url.searchParams.get("narrow"),
    guard.ctx.session.uid,
  );
  const all = url.searchParams.get("all") === "1";
  const countOnly = url.searchParams.get("countOnly") === "1";
  const cursor = url.searchParams.get("cursor");
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : LEADS_LIST_PAGE_SIZE;
  const filters = parseLeadListFilters(url);
  const organizationId = guard.ctx.session.organizationId;
  const viewerUid = guard.ctx.session.uid;
  const listOpts = {
    organizationId,
    narrowToMember,
    viewerUid,
    filters,
  };

  try {
    if (countOnly && url.searchParams.get("prospectActorSelf") === "1") {
      const totalCount = await countCompanyProspectsForActor({
        organizationId,
        userId: viewerUid,
        companyDomain: url.searchParams.get("companyDomain") ?? undefined,
        companyName: url.searchParams.get("companyNameExact") ?? undefined,
      });
      return NextResponse.json({
        ok: true,
        enabled: true,
        source: "postgres" as const,
        totalCount,
        narrow: narrowToMember,
      });
    }

    if (countOnly) {
      const totalCount = await countLeadsInPostgres(listOpts);
      return NextResponse.json({
        ok: true,
        enabled: true,
        source: "postgres" as const,
        totalCount,
        narrow: narrowToMember,
      });
    }

    if (all) {
      const leads = await listLeadsFromPostgres({
        ...listOpts,
        pageSize: Number.isFinite(limit) ? limit : LEADS_LIST_PAGE_SIZE,
      });
      return NextResponse.json({
        ok: true,
        enabled: true,
        leads,
        source: "postgres" as const,
        count: leads.length,
        hasMore: false,
        nextCursor: null,
      });
    }

    const page = await listLeadsPageFromPostgres({
      ...listOpts,
      limit: Number.isFinite(limit) ? Math.min(limit, LEADS_LIST_MAX_PAGE_SIZE) : LEADS_LIST_PAGE_SIZE,
      cursor,
    });
    return NextResponse.json({
      ok: true,
      enabled: true,
      leads: page.leads,
      source: "postgres" as const,
      count: page.leads.length,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    });
  } catch (err) {
    console.error("[org/leads] list failed", organizationId, err);
    return NextResponse.json(
      {
        ok: false,
        enabled: true,
        leads: [],
        source: null,
        error: err instanceof Error ? err.message : "Failed to list leads",
      },
      { status: 500 },
    );
  }
}
