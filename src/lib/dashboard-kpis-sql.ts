/**
 * Phase 2 / 6 — SQL aggregates for dashboard KPIs (hybrid with Node helpers).
 *
 * Lead/deal counts, pipeline, channel mix, and org summary fields run as SQL
 * under `withOrganizationScope` (tenant) or `withRlsBypass` (summary worker).
 *
 * Still Node-side (document shim + pure helpers):
 * - followups, plans, tasks, contacts (cross-collection / JSON workflow rules)
 * - funnelByChannel (CHANNEL_FUNNELS cap logic — slim row load only)
 * - hierarchy-scoped lead visibility (prospect assignees, shared owners)
 * - sentInRange union, bouncedEmails max, sequence status, reply-review gates
 */

import { Prisma } from "@/generated/prisma/client";
import { CHANNEL_LIST } from "@/lib/constants";
import type { DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import { getDashboardRangeStart } from "@/lib/dashboard-date-range";
import {
  computeFunnelByChannel,
  computeOrgPointInTimeGauges,
  type OrgChannelMixRow,
} from "@/lib/dashboard-summary-compute";
import {
  ORG_DASHBOARD_SUMMARY_RANGE_KEYS,
  type OrgDashboardSummary,
  type OrgDashboardSummaryRangeKey,
  type OrgDashboardSummaryRangeMetrics,
} from "@/lib/dashboard-summary";
import { countEmailsSentInRange } from "@/lib/dashboard-emails-sent";
import { IDLE_LEAD_THRESHOLD_DAYS } from "@/lib/lead-idle";
import { dealFromPostgresRow } from "@/lib/db/list-crm-postgres";
import { leadFromPostgresRow } from "@/lib/db/list-leads-postgres";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import {
  type TenantTx,
  withOrganizationScope,
  withRlsBypass,
} from "@/lib/db/tenant-scope";
import type { ChannelKey, Deal, Followup, Lead, User } from "@/lib/types";
import { OWNER_SCOPE_PREFIX } from "@/lib/owner-scope";

/** Bound aggregate query runtime (plan: statement timeouts on KPI SQL). */
export const KPI_SQL_AGGREGATE_STATEMENT_TIMEOUT_MS = 20_000;

const KPI_LEAD_DEAL_CHUNK = 500;

export async function setKpiAggregateStatementTimeout(
  tx: TenantTx,
  timeoutMs: number = KPI_SQL_AGGREGATE_STATEMENT_TIMEOUT_MS,
): Promise<void> {
  const ms = Math.max(1_000, Math.floor(timeoutMs));
  await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(ms)}, true)`;
}

/** ISO timestamp for SQL range boundaries (matches getDashboardRangeStart). */
export function dashboardRangeStartIso(
  range: DashboardTimeRangeKey,
  timeZone: string,
  now: Date = new Date(),
): string {
  return getDashboardRangeStart(range, { now, timeZone }).toISOString();
}

/**
 * Payload *At fields may be ISO strings or accidental document-shim shapes
 * (`{"_date":"…"}` / Firestore seconds). Blind `payload->>'x'::timestamptz` throws
 * Postgres 22007 on object text — coerce the same shapes as coerceInstantMs.
 *
 * `payloadExpr` / `field` are allowlisted identifiers only (never user input).
 */
type SqlPayloadInstantField =
  | "lastActivityAt"
  | "lastReplyAt"
  | "lastEmailOpenedAt";

const SQL_PAYLOAD_INSTANT_FIELDS = new Set<string>([
  "lastActivityAt",
  "lastReplyAt",
  "lastEmailOpenedAt",
]);

const SQL_PAYLOAD_EXPR_RE = /^(?:[a-z_][a-z0-9_]*\.)?payload$/i;

/** Safe `timestamptz` (or NULL) from a lead payload instant field. */
export function sqlPayloadTimestamptz(
  payloadExpr: string,
  field: SqlPayloadInstantField,
): Prisma.Sql {
  if (!SQL_PAYLOAD_EXPR_RE.test(payloadExpr) || !SQL_PAYLOAD_INSTANT_FIELDS.has(field)) {
    throw new Error(`sqlPayloadTimestamptz: unsafe args (${payloadExpr}, ${field})`);
  }
  // Trusted identifiers only — Prisma.raw is required for jsonb path keys.
  return Prisma.raw(`(
    CASE
      WHEN jsonb_typeof(${payloadExpr}->'${field}') = 'string'
        AND NULLIF(BTRIM(${payloadExpr}->>'${field}'), '') IS NOT NULL
        AND BTRIM(${payloadExpr}->>'${field}') ~ '^[0-9]{4}-'
      THEN NULLIF(BTRIM(${payloadExpr}->>'${field}'), '')::timestamptz
      WHEN jsonb_typeof(${payloadExpr}->'${field}') = 'object'
        AND NULLIF(BTRIM(${payloadExpr}->'${field}'->>'_date'), '') IS NOT NULL
        AND BTRIM(${payloadExpr}->'${field}'->>'_date') ~ '^[0-9]{4}-'
      THEN NULLIF(BTRIM(${payloadExpr}->'${field}'->>'_date'), '')::timestamptz
      WHEN jsonb_typeof(${payloadExpr}->'${field}') = 'object'
        AND COALESCE(
          NULLIF(${payloadExpr}->'${field}'->>'_seconds', ''),
          NULLIF(${payloadExpr}->'${field}'->>'seconds', '')
        ) ~ '^[0-9]+([.][0-9]+)?$'
      THEN to_timestamp(
        COALESCE(
          (${payloadExpr}->'${field}'->>'_seconds')::double precision,
          (${payloadExpr}->'${field}'->>'seconds')::double precision
        )
      )
      ELSE NULL
    END
  )`);
}

type SqlOwnerScopeFilter = {
  sql: Prisma.Sql;
  /** When true, caller must apply hierarchy in Node (prospect / unassigned rules). */
  needsNodeHierarchy: boolean;
};

/**
 * Push owner-scope filters into SQL where parity is exact.
 * `unassigned` and hierarchy prospect rules stay in Node.
 */
export function buildSqlOwnerScopeFilter(
  ownerScope: string,
  currentUserId: string,
  users: readonly User[],
): SqlOwnerScopeFilter {
  const scope = ownerScope.trim() || "all-owners";
  if (scope === "all-owners" || scope === "open-queue") {
    return { sql: Prisma.sql`TRUE`, needsNodeHierarchy: false };
  }
  if (scope === "me") {
    return {
      sql: Prisma.sql`l.owner_id = ${currentUserId}`,
      needsNodeHierarchy: false,
    };
  }
  if (scope === "team") {
    const peerIds = users.filter((u) => u.id !== currentUserId).map((u) => u.id);
    if (peerIds.length === 0) {
      return { sql: Prisma.sql`FALSE`, needsNodeHierarchy: false };
    }
    return {
      sql: Prisma.sql`l.owner_id IN (${Prisma.join(peerIds)})`,
      needsNodeHierarchy: false,
    };
  }
  if (scope.startsWith(OWNER_SCOPE_PREFIX)) {
    const uid = scope.slice(OWNER_SCOPE_PREFIX.length);
    return { sql: Prisma.sql`l.owner_id = ${uid}`, needsNodeHierarchy: false };
  }
  if (scope === "unassigned") {
    return { sql: Prisma.sql`TRUE`, needsNodeHierarchy: true };
  }
  return { sql: Prisma.sql`TRUE`, needsNodeHierarchy: true };
}

function buildSqlChannelFilter(channels: readonly ChannelKey[]): Prisma.Sql {
  if (!channels.length) return Prisma.sql`TRUE`;
  return Prisma.sql`l.channel IN (${Prisma.join([...channels])})`;
}

/** Mirrors filterLeadsByDateRange — open leads always kept. */
function buildSqlLeadDateRangeFilter(
  range: DashboardTimeRangeKey,
  rangeStartIso: string,
): Prisma.Sql {
  if (range === "all") return Prisma.sql`TRUE`;
  const start = rangeStartIso;
  const lastActivity = sqlPayloadTimestamptz("l.payload", "lastActivityAt");
  return Prisma.sql`(
    l.stage NOT IN ('won', 'lost')
    OR COALESCE(
      ${lastActivity},
      l.updated_at,
      l.created_at
    ) >= ${start}::timestamptz
    OR l.updated_at >= ${start}::timestamptz
    OR l.created_at >= ${start}::timestamptz
  )`;
}

/** Mirrors filterDealsByDateRange for deal-side aggregates. */
function buildSqlDealDateRangeFilter(
  range: DashboardTimeRangeKey,
  rangeStartIso: string,
  tableAlias = "d",
): Prisma.Sql {
  if (range === "all") return Prisma.sql`TRUE`;
  const start = rangeStartIso;
  const t = Prisma.raw(tableAlias);
  return Prisma.sql`(
    ${t}.updated_at >= ${start}::timestamptz
    OR ${t}.created_at >= ${start}::timestamptz
    OR (
      ${t}.stage NOT IN ('won', 'lost')
      AND ${t}.expected_close_date >= ${start}::timestamptz
    )
  )`;
}

export type SqlLeadDealAggregateSnapshot = {
  openPipelineValue: number;
  openDealCount: number;
  leadEstimateContributors: number;
  pipelineByStage: Record<string, number>;
  channelMix: Record<string, OrgChannelMixRow>;
  closedRevenue: number;
  wonDealCount: number;
  /** True when SQL could not express owner/hierarchy — use Node pipeline fields. */
  usedNodeFallback: boolean;
};

type PipelineStageRow = { stage: string; count: bigint };
type ChannelMixRow = { channel: string; count: bigint; won: bigint };
type ClosedRow = { closed_revenue: number | null; won_deal_count: bigint };

async function queryOpenPipelineGauges(
  tx: TenantTx,
  organizationId: string,
  leadWhere: Prisma.Sql,
  dealWhere: Prisma.Sql,
  dealDateForExists: Prisma.Sql,
): Promise<{
  openPipelineValue: number;
  openDealCount: number;
  leadEstimateContributors: number;
}> {
  const dealAgg = await tx.$queryRaw<
    { open_deal_count: bigint; open_deal_value: number | null }[]
  >`
    SELECT
      COUNT(*)::bigint AS open_deal_count,
      COALESCE(SUM(d.value), 0)::float8 AS open_deal_value
    FROM deals d
    WHERE d.organization_id = ${organizationId}
      AND d.stage NOT IN ('won', 'lost')
      AND ${dealWhere}
  `;
  const leadAgg = await tx.$queryRaw<
    { estimate_total: number | null; estimate_contributors: bigint }[]
  >`
    SELECT
      COALESCE(SUM(
        COALESCE(NULLIF(l.payload->>'estimatedValue', '')::float8, 0)
      ), 0)::float8 AS estimate_total,
      COUNT(*) FILTER (
        WHERE COALESCE(NULLIF(l.payload->>'estimatedValue', '')::float8, 0) > 0
      )::bigint AS estimate_contributors
    FROM leads l
    WHERE l.organization_id = ${organizationId}
      AND (l.intake_kind IS NULL OR l.intake_kind <> 'prospect')
      AND l.stage NOT IN ('won', 'lost')
      AND ${leadWhere}
      AND NOT EXISTS (
        SELECT 1 FROM deals d2
        WHERE d2.organization_id = ${organizationId}
          AND d2.lead_id = l.id
          AND d2.stage NOT IN ('won', 'lost')
          AND ${dealDateForExists}
      )
  `;
  const openDealCount = Number(dealAgg[0]?.open_deal_count ?? BigInt(0));
  const openDealValue = Number(dealAgg[0]?.open_deal_value ?? 0);
  const estimateTotal = Number(leadAgg[0]?.estimate_total ?? 0);
  const leadEstimateContributors = Number(leadAgg[0]?.estimate_contributors ?? BigInt(0));
  return {
    openPipelineValue: openDealValue + estimateTotal,
    openDealCount,
    leadEstimateContributors,
  };
}

async function queryPipelineByStage(
  tx: TenantTx,
  organizationId: string,
  leadWhere: Prisma.Sql,
): Promise<Record<string, number>> {
  const rows = await tx.$queryRaw<PipelineStageRow[]>`
    SELECT l.stage, COUNT(*)::bigint AS count
    FROM leads l
    WHERE l.organization_id = ${organizationId}
      AND (l.intake_kind IS NULL OR l.intake_kind <> 'prospect')
      AND ${leadWhere}
    GROUP BY l.stage
  `;
  const out: Record<string, number> = {};
  for (const row of rows) {
    const stage = row.stage?.trim() || "new";
    out[stage] = Number(row.count);
  }
  return out;
}

async function queryChannelMix(
  tx: TenantTx,
  organizationId: string,
  leadWhere: Prisma.Sql,
): Promise<Record<string, OrgChannelMixRow>> {
  const rows = await tx.$queryRaw<ChannelMixRow[]>`
    SELECT
      l.channel,
      COUNT(*)::bigint AS count,
      COUNT(*) FILTER (WHERE l.stage = 'won')::bigint AS won
    FROM leads l
    WHERE l.organization_id = ${organizationId}
      AND (l.intake_kind IS NULL OR l.intake_kind <> 'prospect')
      AND ${leadWhere}
    GROUP BY l.channel
  `;
  const out: Record<string, OrgChannelMixRow> = {};
  for (const row of rows) {
    if (!row.channel) continue;
    out[row.channel] = { count: Number(row.count), won: Number(row.won) };
  }
  return out;
}

async function queryClosedRevenue(
  tx: TenantTx,
  organizationId: string,
  dealWhere: Prisma.Sql,
  range: DashboardTimeRangeKey,
  rangeStartIso: string,
): Promise<{ closedRevenue: number; wonDealCount: number }> {
  const rangeFilter =
    range === "all"
      ? Prisma.sql`TRUE`
      : Prisma.sql`(
          COALESCE(d.won_at, d.updated_at, d.created_at) >= ${rangeStartIso}::timestamptz
        )`;
  const rows = await tx.$queryRaw<ClosedRow[]>`
    SELECT
      COALESCE(SUM(d.value), 0)::float8 AS closed_revenue,
      COUNT(*)::bigint AS won_deal_count
    FROM deals d
    WHERE d.organization_id = ${organizationId}
      AND d.stage = 'won'
      AND ${dealWhere}
      AND ${rangeFilter}
  `;
  return {
    closedRevenue: Number(rows[0]?.closed_revenue ?? 0),
    wonDealCount: Number(rows[0]?.won_deal_count ?? BigInt(0)),
  };
}

export type SqlScopedLeadDealAggregateInput = {
  organizationId: string;
  range: DashboardTimeRangeKey;
  timeZone: string;
  channels: readonly ChannelKey[];
  ownerScope: string;
  currentUserId: string;
  users: readonly User[];
  /** When set, restrict deals to these lead ids (post-hierarchy Node filter). */
  dealLeadIds?: readonly string[];
  now?: Date;
  /** Worker summary path bypasses RLS. */
  bypassRls?: boolean;
};

/**
 * SQL aggregates for pipeline / channel / closed-won metrics.
 * Returns `usedNodeFallback` when hierarchy or unassigned scope needs Node.
 */
export async function fetchScopedLeadDealSqlAggregates(
  input: SqlScopedLeadDealAggregateInput,
): Promise<SqlLeadDealAggregateSnapshot | null> {
  if (!isDatabaseConfigured()) return null;
  const orgId = input.organizationId.trim();
  if (!orgId) return null;

  const ownerFilter = buildSqlOwnerScopeFilter(
    input.ownerScope,
    input.currentUserId,
    input.users,
  );
  if (ownerFilter.needsNodeHierarchy) {
    return {
      openPipelineValue: 0,
      openDealCount: 0,
      leadEstimateContributors: 0,
      pipelineByStage: {},
      channelMix: {},
      closedRevenue: 0,
      wonDealCount: 0,
      usedNodeFallback: true,
    };
  }

  const rangeStart = dashboardRangeStartIso(input.range, input.timeZone, input.now);
  const leadDate = buildSqlLeadDateRangeFilter(input.range, rangeStart);
  const dealDate = buildSqlDealDateRangeFilter(input.range, rangeStart, "d");
  const dealDateD2 = buildSqlDealDateRangeFilter(input.range, rangeStart, "d2");
  const channel = buildSqlChannelFilter(input.channels);

  const leadWhere = Prisma.sql`${ownerFilter.sql} AND ${channel} AND ${leadDate}`;
  let dealWhere = Prisma.sql`${dealDate}`;
  if (input.dealLeadIds && input.dealLeadIds.length > 0) {
    dealWhere = Prisma.sql`${dealWhere} AND d.lead_id IN (${Prisma.join([...input.dealLeadIds])})`;
  } else if (input.channels.length > 0 || input.ownerScope !== "all-owners") {
    dealWhere = Prisma.sql`${dealWhere} AND EXISTS (
      SELECT 1 FROM leads l
      WHERE l.organization_id = ${orgId}
        AND l.id = d.lead_id
        AND ${leadWhere}
    )`;
  }

  const run = async (tx: TenantTx) => {
    await setKpiAggregateStatementTimeout(tx);
    const [pipeline, pipelineByStage, channelMix, closed] = await Promise.all([
      queryOpenPipelineGauges(tx, orgId, leadWhere, dealWhere, dealDateD2),
      queryPipelineByStage(tx, orgId, leadWhere),
      queryChannelMix(tx, orgId, leadWhere),
      queryClosedRevenue(tx, orgId, dealWhere, input.range, rangeStart),
    ]);
    return {
      ...pipeline,
      pipelineByStage,
      channelMix,
      closedRevenue: closed.closedRevenue,
      wonDealCount: closed.wonDealCount,
      usedNodeFallback: false,
    };
  };

  if (input.bypassRls) {
    return withRlsBypass(run);
  }
  return withOrganizationScope(orgId, run);
}

/** Chunked slim lead load for KPI / ops paths (no list-all pagination helper). */
export async function fetchKpiSlimLeadsForOrg(
  organizationId: string,
  opts?: { bypassRls?: boolean },
): Promise<Lead[]> {
  if (!isDatabaseConfigured()) return [];
  const orgId = organizationId.trim();
  if (!orgId) return [];

  const load = async (tx: TenantTx) => {
    await setKpiAggregateStatementTimeout(tx);
    const acc: Lead[] = [];
    let cursor: { updatedAt: Date; id: string } | undefined;
    for (;;) {
      const cursorWhere = cursor
        ? {
            OR: [
              { updatedAt: { lt: cursor.updatedAt } },
              { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
            ],
          }
        : {};
      const rows = await tx.lead.findMany({
        where: { organizationId: orgId, ...cursorWhere },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: KPI_LEAD_DEAL_CHUNK,
      });
      for (const row of rows) {
        acc.push(leadFromPostgresRow(row, { slim: true }));
      }
      if (rows.length < KPI_LEAD_DEAL_CHUNK) break;
      const last = rows[rows.length - 1]!;
      cursor = { updatedAt: last.updatedAt, id: last.id };
    }
    return acc;
  };

  if (opts?.bypassRls) return withRlsBypass(load);
  return withOrganizationScope(orgId, load);
}

/** Chunked slim deal load for KPI / ops paths. */
export async function fetchKpiSlimDealsForOrg(
  organizationId: string,
  opts?: { bypassRls?: boolean },
): Promise<Deal[]> {
  if (!isDatabaseConfigured()) return [];
  const orgId = organizationId.trim();
  if (!orgId) return [];

  const load = async (tx: TenantTx) => {
    await setKpiAggregateStatementTimeout(tx);
    const acc: Deal[] = [];
    let cursor: { updatedAt: Date; id: string } | undefined;
    for (;;) {
      const cursorWhere = cursor
        ? {
            OR: [
              { updatedAt: { lt: cursor.updatedAt } },
              { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
            ],
          }
        : {};
      const rows = await tx.deal.findMany({
        where: { organizationId: orgId, ...cursorWhere },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: KPI_LEAD_DEAL_CHUNK,
      });
      for (const row of rows) {
        acc.push(dealFromPostgresRow(row));
      }
      if (rows.length < KPI_LEAD_DEAL_CHUNK) break;
      const last = rows[rows.length - 1]!;
      cursor = { updatedAt: last.updatedAt, id: last.id };
    }
    return acc;
  };

  if (opts?.bypassRls) return withRlsBypass(load);
  return withOrganizationScope(orgId, load);
}

/** Minimal rows for funnelByChannel only (Phase 6 hybrid). */
export async function fetchFunnelSliceForOrg(
  organizationId: string,
): Promise<{ leads: Lead[]; deals: Deal[] }> {
  const [leads, deals] = await Promise.all([
    fetchKpiSlimLeadsForOrg(organizationId, { bypassRls: true }),
    fetchKpiSlimDealsForOrg(organizationId, { bypassRls: true }),
  ]);
  return { leads, deals };
}

export type OrgSummarySqlPointMetrics = {
  openSalesLeads: number;
  idleSalesLeads: number;
  prospects: number;
  prospectsNeedRouting: number;
  prospectsReadyToPush: number;
  prospectsPushed: number;
  totalReplies: number;
  repliesPendingReview: number;
};

async function queryOrgPointMetricsSql(
  tx: TenantTx,
  organizationId: string,
): Promise<OrgSummarySqlPointMetrics> {
  const rows = await tx.$queryRaw<
    {
      open_sales_leads: bigint;
      idle_sales_leads: bigint;
      prospects: bigint;
      prospects_need_routing: bigint;
      prospects_ready_to_push: bigint;
      prospects_pushed: bigint;
      total_replies: bigint;
      replies_pending_review: bigint;
    }[]
  >`
    SELECT
      COUNT(*) FILTER (
        WHERE (intake_kind IS NULL OR intake_kind <> 'prospect')
          AND stage NOT IN ('won', 'lost')
      )::bigint AS open_sales_leads,
      COUNT(*) FILTER (
        WHERE (intake_kind IS NULL OR intake_kind <> 'prospect')
          AND stage NOT IN ('won', 'lost')
          AND EXTRACT(EPOCH FROM (
            NOW() - COALESCE(
              ${sqlPayloadTimestamptz("payload", "lastActivityAt")},
              updated_at,
              created_at
            )
          )) / 86400 >= ${IDLE_LEAD_THRESHOLD_DAYS}
      )::bigint AS idle_sales_leads,
      COUNT(*) FILTER (WHERE intake_kind = 'prospect')::bigint AS prospects,
      COUNT(*) FILTER (
        WHERE intake_kind = 'prospect'
          AND (
            payload->'prospectChannelAssignments' IS NULL
            OR jsonb_typeof(payload->'prospectChannelAssignments') <> 'array'
            OR jsonb_array_length(payload->'prospectChannelAssignments') = 0
          )
      )::bigint AS prospects_need_routing,
      COUNT(*) FILTER (
        WHERE intake_kind = 'prospect'
          AND jsonb_typeof(payload->'prospectChannelAssignments') = 'array'
          AND jsonb_array_length(payload->'prospectChannelAssignments') > 0
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(payload->'prospectChannelAssignments') elem
            WHERE elem->>'pushedAt' IS NULL OR BTRIM(elem->>'pushedAt') = ''
          )
      )::bigint AS prospects_ready_to_push,
      COUNT(*) FILTER (
        WHERE intake_kind = 'prospect'
          AND NULLIF(BTRIM(payload->>'linkedSalesLeadId'), '') IS NOT NULL
      )::bigint AS prospects_pushed,
      COUNT(*) FILTER (
        WHERE (
          ${sqlPayloadTimestamptz("payload", "lastReplyAt")} IS NOT NULL
          OR stage IN ('replied', 'qualified', 'discovery', 'proposal', 'negotiation')
        )
        AND stage <> 'lost'
      )::bigint AS total_replies,
      0::bigint AS replies_pending_review
    FROM leads
    WHERE organization_id = ${organizationId}
  `;
  const row = rows[0];
  return {
    openSalesLeads: Number(row?.open_sales_leads ?? BigInt(0)),
    idleSalesLeads: Number(row?.idle_sales_leads ?? BigInt(0)),
    prospects: Number(row?.prospects ?? BigInt(0)),
    prospectsNeedRouting: Number(row?.prospects_need_routing ?? BigInt(0)),
    prospectsReadyToPush: Number(row?.prospects_ready_to_push ?? BigInt(0)),
    prospectsPushed: Number(row?.prospects_pushed ?? BigInt(0)),
    totalReplies: Number(row?.total_replies ?? BigInt(0)),
    repliesPendingReview: Number(row?.replies_pending_review ?? BigInt(0)),
  };
}

async function queryOrgRangeMetricsSql(
  tx: TenantTx,
  organizationId: string,
  range: OrgDashboardSummaryRangeKey,
  timeZone: string,
  now: Date,
): Promise<{
  sent: number;
  replies: number;
  opens: number;
  closedRevenue: number;
  wonDealCount: number;
}> {
  const start = dashboardRangeStartIso(range, timeZone, now);
  const wonWindow =
    range === "all"
      ? Prisma.sql`TRUE`
      : Prisma.sql`COALESCE(d.won_at, d.updated_at, d.created_at) >= ${start}::timestamptz`;
  const rows = await tx.$queryRaw<
    { replies: bigint; opens: bigint; closed_revenue: number | null; won_deal_count: bigint }[]
  >`
    SELECT
      COUNT(*) FILTER (
        WHERE ${sqlPayloadTimestamptz("payload", "lastReplyAt")} IS NOT NULL
          AND (${sqlPayloadTimestamptz("payload", "lastReplyAt")} >= ${start}::timestamptz)
      )::bigint AS replies,
      COUNT(*) FILTER (
        WHERE ${sqlPayloadTimestamptz("payload", "lastEmailOpenedAt")} IS NOT NULL
          AND (${sqlPayloadTimestamptz("payload", "lastEmailOpenedAt")} >= ${start}::timestamptz)
      )::bigint AS opens,
      (
        SELECT COALESCE(SUM(d.value), 0)::float8
        FROM deals d
        WHERE d.organization_id = ${organizationId}
          AND d.stage = 'won'
          AND ${wonWindow}
      ) AS closed_revenue,
      (
        SELECT COUNT(*)::bigint
        FROM deals d
        WHERE d.organization_id = ${organizationId}
          AND d.stage = 'won'
          AND ${wonWindow}
      ) AS won_deal_count
    FROM leads
    WHERE organization_id = ${organizationId}
  `;
  const row = rows[0];
  return {
    sent: 0,
    replies: Number(row?.replies ?? BigInt(0)),
    opens: Number(row?.opens ?? BigInt(0)),
    closedRevenue: Number(row?.closed_revenue ?? 0),
    wonDealCount: Number(row?.won_deal_count ?? BigInt(0)),
  };
}

/**
 * Org-wide summary fields via SQL + slim funnel slice + followups for sent/bounce.
 * `repliesPendingReview` still refined in Node from slim leads when needed.
 */
export async function computeOrgDashboardSummaryFieldsWithSql(input: {
  organizationId: string;
  followups: readonly Followup[];
  timeZone?: string;
  now?: Date;
  extraSentAts?: readonly number[];
}): Promise<Omit<
  OrgDashboardSummary,
  "id" | "organizationId" | "version" | "updatedAt"
> | null> {
  if (!isDatabaseConfigured()) return null;
  const orgId = input.organizationId.trim();
  if (!orgId) return null;
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? "UTC";

  const sqlCore = await withRlsBypass(async (tx) => {
    await setKpiAggregateStatementTimeout(tx);
    const ownerFilter = buildSqlOwnerScopeFilter("all-owners", "", []);
    const leadWhere = Prisma.sql`${ownerFilter.sql} AND TRUE AND TRUE`;
    const dealWhere = Prisma.sql`TRUE`;
    const dealDateD2 = Prisma.sql`TRUE`;
    const [pointSql, pipeline, pipelineByStage, channelMix] = await Promise.all([
      queryOrgPointMetricsSql(tx, orgId),
      queryOpenPipelineGauges(tx, orgId, leadWhere, dealWhere, dealDateD2),
      queryPipelineByStage(tx, orgId, leadWhere),
      queryChannelMix(tx, orgId, leadWhere),
    ]);
    const pipelineAgg: SqlLeadDealAggregateSnapshot = {
      ...pipeline,
      pipelineByStage,
      channelMix,
      closedRevenue: 0,
      wonDealCount: 0,
      usedNodeFallback: false,
    };
    return { pointSql, pipelineAgg };
  });

  if (!sqlCore.pipelineAgg || sqlCore.pipelineAgg.usedNodeFallback) return null;

  const { leads, deals } = await fetchFunnelSliceForOrg(orgId);

  const pointFromLeads = computeOrgPointInTimeGauges({
    leads,
    followups: input.followups,
    timeZone,
    now,
  });

  const ranges: OrgDashboardSummary["ranges"] = {};
  for (const key of ORG_DASHBOARD_SUMMARY_RANGE_KEYS) {
    const partial = await withRlsBypass(async (tx) => {
      await setKpiAggregateStatementTimeout(tx);
      return queryOrgRangeMetricsSql(tx, orgId, key, timeZone, now);
    });
    const sent = countEmailsSentInRange({
      followups: input.followups,
      extraSentAts: input.extraSentAts,
      rangeStart: getDashboardRangeStart(key, { now, timeZone }).getTime(),
    });
    ranges[key] = {
      sent,
      replies: partial.replies,
      opens: partial.opens,
      bounced: 0,
      closedRevenue: partial.closedRevenue,
      wonDealCount: partial.wonDealCount,
    };
  }

  return {
    openSalesLeads: sqlCore.pointSql.openSalesLeads,
    idleSalesLeads: sqlCore.pointSql.idleSalesLeads,
    prospects: sqlCore.pointSql.prospects,
    prospectsNeedRouting: sqlCore.pointSql.prospectsNeedRouting,
    prospectsReadyToPush: sqlCore.pointSql.prospectsReadyToPush,
    prospectsPushed: sqlCore.pointSql.prospectsPushed,
    followupsDue: pointFromLeads.followupsDue,
    overdueFollowups: pointFromLeads.overdueFollowups,
    totalReplies: sqlCore.pointSql.totalReplies,
    repliesPendingReview: pointFromLeads.repliesPendingReview,
    openPipelineValue: sqlCore.pipelineAgg.openPipelineValue,
    openDealCount: sqlCore.pipelineAgg.openDealCount,
    leadEstimateContributors: sqlCore.pipelineAgg.leadEstimateContributors,
    pipelineByStage: sqlCore.pipelineAgg.pipelineByStage,
    channelMix: sqlCore.pipelineAgg.channelMix,
    funnelByChannel: computeFunnelByChannel(leads, deals),
    ranges,
  };
}

/** Merge SQL lead/deal aggregates into a scoped KPI payload (pipeline section). */
export function applySqlLeadDealAggregatesToKpiPayload<
  T extends {
    pipeline: {
      openPipelineValue: number;
      openDealCount: number;
      leadEstimateContributors: number;
    };
    pipelineByStage: Record<string, number>;
    channelMix: Record<string, OrgChannelMixRow>;
    closedRevenue: number;
    wonDealCount: number;
  },
>(computed: T, sql: SqlLeadDealAggregateSnapshot | null): T {
  if (!sql || sql.usedNodeFallback) return computed;
  return {
    ...computed,
    pipeline: {
      openPipelineValue: sql.openPipelineValue,
      openDealCount: sql.openDealCount,
      leadEstimateContributors: sql.leadEstimateContributors,
    },
    pipelineByStage: sql.pipelineByStage,
    channelMix: sql.channelMix,
    closedRevenue: sql.closedRevenue,
    wonDealCount: sql.wonDealCount,
  };
}

/** Validate channel mix keys against known channels (stable ordering for tests). */
export function normalizeChannelMixKeys(
  mix: Record<string, OrgChannelMixRow>,
): Record<string, OrgChannelMixRow> {
  const allowed = new Set(CHANNEL_LIST.map((c) => c.key));
  const out: Record<string, OrgChannelMixRow> = {};
  for (const [key, row] of Object.entries(mix)) {
    if (allowed.has(key as ChannelKey)) out[key] = row;
  }
  return out;
}

/** Node fallback for org range metrics when comparing parity (sent/bounced). */
export function orgRangeMetricsNodeSent(input: {
  followups: readonly Followup[];
  extraSentAts?: readonly number[];
  range: OrgDashboardSummaryRangeKey;
  timeZone: string;
  now?: Date;
}): number {
  const now = input.now ?? new Date();
  const start = getDashboardRangeStart(input.range, { now, timeZone: input.timeZone }).getTime();
  return countEmailsSentInRange({
    followups: input.followups,
    extraSentAts: input.extraSentAts,
    rangeStart: start,
  });
}

/** Compare org-wide SQL vs Node compute for summary (excludes known deltas). */
export function summaryFieldsWithinAcceptedDeltas(
  node: OrgDashboardSummaryRangeMetrics,
  sql: { sent: number; replies: number; opens: number; closedRevenue: number; wonDealCount: number },
  opts?: { skipSent?: boolean },
): boolean {
  if (!opts?.skipSent && node.sent !== sql.sent) return false;
  if (node.replies !== sql.replies) return false;
  if (node.opens !== sql.opens) return false;
  if (node.closedRevenue !== sql.closedRevenue) return false;
  if (node.wonDealCount !== sql.wonDealCount) return false;
  return true;
}
