/**
 * Postgres leads list read (P2.10). Tenant-scoped via RLS (`withOrganizationScope`).
 * Reconstructs UI `Lead` rows from query columns + dual-write `payload` JSON.
 *
 * List path is paginated (cursor) and strips known heavy payload keys so one
 * poll cannot hold a transaction / serialize multi‑MB blobs.
 */

import type { Lead as PrismaLead, Prisma } from "@/generated/prisma/client";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import { mapLeadDoc } from "@/lib/leads/map-lead-doc";
import type { Lead } from "@/lib/types";

/** Default page size for workspace polls / API. */
export const LEADS_LIST_PAGE_SIZE = 250;
/** Hard cap per request (engineering rule: no unbounded collection fetch). */
export const LEADS_LIST_MAX_PAGE_SIZE = 500;
/** Max pages when assembling a full workspace snapshot. */
export const LEADS_LIST_MAX_PAGES = 40;

/**
 * Payload keys that can be multi‑KB/MB and are not needed for list/board UI.
 * Detail views that need them should load a single lead (future P2.x).
 */
export const HEAVY_LEAD_PAYLOAD_KEYS = [
  "aiContext",
  "aiPromptContext",
  "aiReplyContext",
  "rawImportRow",
  "importRaw",
  "rawPayload",
  "scrapeHtml",
  "scrapeRaw",
  "htmlBody",
  "emailBodies",
  "conversationTranscript",
  "transcript",
  "mailboxSyncRaw",
] as const;

export type ListLeadsPostgresOptions = {
  organizationId: string;
  /** When true, mirror Firestore member-scope slices (owner / manager / assignee / shared). */
  narrowToMember?: boolean;
  viewerUid?: string;
  /** Page size (clamped). */
  limit?: number;
  /** Opaque cursor from a previous page (`updatedAt|id`). */
  cursor?: string | null;
};

export type ListLeadsPostgresPage = {
  leads: Lead[];
  nextCursor: string | null;
  hasMore: boolean;
};

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return {};
}

/** Drop known heavy blobs + truncate very long notes for list responses. */
export function slimLeadPayload(payload: unknown): Record<string, unknown> {
  const raw = payloadRecord(payload);
  const out: Record<string, unknown> = { ...raw };
  for (const key of HEAVY_LEAD_PAYLOAD_KEYS) {
    delete out[key];
  }
  if (typeof out.notes === "string" && out.notes.length > 2_000) {
    out.notes = `${out.notes.slice(0, 2_000)}…`;
  }
  return out;
}

function stringArrayIncludes(raw: unknown, uid: string): boolean {
  return Array.isArray(raw) && raw.some((v) => typeof v === "string" && v === uid);
}

/** Same visibility slices as Firestore `subscribeLeads` member queries. */
export function leadMatchesMemberScope(lead: Lead, viewerUid: string): boolean {
  if (!viewerUid) return false;
  if (lead.ownerId === viewerUid) return true;
  if (stringArrayIncludes(lead.ownerManagerIds, viewerUid)) return true;
  if (
    lead.intakeKind === "prospect" &&
    stringArrayIncludes(lead.prospectAssigneeIds, viewerUid)
  ) {
    return true;
  }
  if (stringArrayIncludes(lead.sharedOwnerIds, viewerUid)) return true;
  return false;
}

/**
 * Prisma WHERE for member-scoped lead lists.
 * Must be applied in SQL (not after pagination) so reps/managers get a full
 * page of *their* rows instead of the org's newest N filtered down to ~0.
 */
export function memberLeadScopeWhere(viewerUid: string): Prisma.LeadWhereInput {
  const uid = viewerUid.trim();
  if (!uid) return { id: "__never__" };
  return {
    OR: [
      { ownerId: uid },
      { payload: { path: ["ownerManagerIds"], array_contains: uid } },
      { payload: { path: ["sharedOwnerIds"], array_contains: uid } },
      {
        AND: [
          { intakeKind: "prospect" },
          { payload: { path: ["prospectAssigneeIds"], array_contains: uid } },
        ],
      },
    ],
  };
}

/** Map a dual-written Postgres lead row into the workspace `Lead` type. */
export function leadFromPostgresRow(
  row: PrismaLead,
  opts?: { slim?: boolean },
): Lead {
  const payload = opts?.slim === false ? payloadRecord(row.payload) : slimLeadPayload(row.payload);
  const raw: Record<string, unknown> = {
    ...payload,
    organizationId: row.organizationId,
    accountId: row.accountId,
    contactId: row.contactId,
    channel: row.channel,
    stage: row.stage,
    temperature: row.temperature,
    priority: row.priority,
    ownerId: row.ownerId,
    contactName: row.contactName,
    companyName: row.companyName,
    intakeKind: row.intakeKind ?? undefined,
    touches: row.touches,
    isIdle: row.isIdle,
    archivedAt: row.archivedAt
      ? row.archivedAt.toISOString()
      : payload.archivedAt,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  return mapLeadDoc(row.id, raw);
}

export function encodeLeadsListCursor(updatedAt: Date, id: string): string {
  return `${updatedAt.toISOString()}|${id}`;
}

export function decodeLeadsListCursor(
  cursor: string | null | undefined,
): { updatedAt: Date; id: string } | null {
  if (!cursor?.trim()) return null;
  const sep = cursor.indexOf("|");
  if (sep <= 0) return null;
  const updatedAt = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (!id || Number.isNaN(updatedAt.getTime())) return null;
  return { updatedAt, id };
}

function clampPageSize(limit: number | undefined): number {
  const raw = typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : LEADS_LIST_PAGE_SIZE;
  return Math.max(1, Math.min(LEADS_LIST_MAX_PAGE_SIZE, raw));
}

/**
 * One page of leads for an org (newest `updatedAt` first).
 * Returns [] / empty page when DATABASE_URL is unset.
 */
export async function listLeadsPageFromPostgres(
  options: ListLeadsPostgresOptions,
): Promise<ListLeadsPostgresPage> {
  if (!isDatabaseConfigured()) {
    return { leads: [], nextCursor: null, hasMore: false };
  }

  const organizationId = options.organizationId.trim();
  if (!organizationId) {
    return { leads: [], nextCursor: null, hasMore: false };
  }

  const take = clampPageSize(options.limit);
  const decoded = decodeLeadsListCursor(options.cursor);
  const narrow =
    Boolean(options.narrowToMember) && Boolean(options.viewerUid?.trim());

  const cursorClause: Prisma.LeadWhereInput | null = decoded
    ? {
        OR: [
          { updatedAt: { lt: decoded.updatedAt } },
          { updatedAt: decoded.updatedAt, id: { lt: decoded.id } },
        ],
      }
    : null;

  const where: Prisma.LeadWhereInput = {
    organizationId,
    ...(narrow
      ? {
          AND: [
            memberLeadScopeWhere(options.viewerUid!),
            ...(cursorClause ? [cursorClause] : []),
          ],
        }
      : cursorClause
        ? cursorClause
        : {}),
  };

  const rows = await withOrganizationScope(organizationId, (tx) =>
    tx.lead.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: take + 1,
    }),
  );

  const hasMore = rows.length > take;
  const pageRows = hasMore ? rows.slice(0, take) : rows;
  const leads = pageRows.map((row) => leadFromPostgresRow(row, { slim: true }));

  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last ? encodeLeadsListCursor(last.updatedAt, last.id) : null;

  return { leads, nextCursor, hasMore };
}

/**
 * Assemble a full org leads snapshot by walking cursor pages (short transactions).
 * Caps at {@link LEADS_LIST_MAX_PAGES} × page size.
 */
export async function listLeadsFromPostgres(
  options: Omit<ListLeadsPostgresOptions, "cursor" | "limit"> & {
    pageSize?: number;
    maxPages?: number;
  },
): Promise<Lead[]> {
  const pageSize = clampPageSize(options.pageSize ?? LEADS_LIST_PAGE_SIZE);
  const maxPages = Math.max(
    1,
    Math.min(LEADS_LIST_MAX_PAGES, Math.floor(options.maxPages ?? LEADS_LIST_MAX_PAGES)),
  );

  const all: Lead[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await listLeadsPageFromPostgres({
      organizationId: options.organizationId,
      narrowToMember: options.narrowToMember,
      viewerUid: options.viewerUid,
      limit: pageSize,
      cursor,
    });
    all.push(...result.leads);
    if (!result.hasMore || !result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return all;
}
