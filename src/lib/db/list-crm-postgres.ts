/**
 * Postgres accounts / contacts / deals list reads (P6.1).
 * Tenant-scoped via RLS (`withOrganizationScope`).
 * Reconstructs UI rows from query columns + dual-write `payload` JSON.
 */

import type {
  Account as PrismaAccount,
  Contact as PrismaContact,
  Deal as PrismaDeal,
  Prisma,
} from "@/generated/prisma/client";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import {
  accountListFilterWhere,
  contactListFilterWhere,
  dealListFilterWhere,
  type CrmEntityListFilters,
} from "@/lib/db/crm-list-filters";
import { countLeadsInPostgres, leadFromPostgresRow } from "@/lib/db/list-leads-postgres";
import { documentTimestampToIso } from "@/lib/documents/timestamp-util";
import {
  mapDealStageGroupSums,
  type DealStageSum,
} from "@/lib/deals/stage-sum-money";
import type { Account, Contact, Deal, Lead, PipelineStage } from "@/lib/types";

/** Default page size for workspace polls / API. */
export const CRM_LIST_PAGE_SIZE = 250;
/** Hard cap per request. */
export const CRM_LIST_MAX_PAGE_SIZE = 500;
/** Max pages when assembling a full workspace snapshot. */
export const CRM_LIST_MAX_PAGES = 40;

export type ListCrmPostgresOptions = {
  organizationId: string;
  /** When true, mirror Firestore owner / ownerManagerIds slices. */
  narrowToMember?: boolean;
  viewerUid?: string;
  limit?: number;
  cursor?: string | null;
  filters?: CrmEntityListFilters;
};

export type ListAccountsPostgresPage = {
  accounts: Account[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type ListContactsPostgresPage = {
  contacts: Contact[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type ListDealsPostgresPage = {
  deals: Deal[];
  nextCursor: string | null;
  hasMore: boolean;
};

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return {};
}

function stringArrayIncludes(raw: unknown, uid: string): boolean {
  return Array.isArray(raw) && raw.some((v) => typeof v === "string" && v === uid);
}

/** Same visibility slices as Firestore `subscribeOwnedByOwnerOrManager` for CRM entities. */
export function ownedMatchesMemberScope(
  row: { ownerId: string; ownerManagerIds?: string[] },
  viewerUid: string,
): boolean {
  if (!viewerUid) return false;
  if (row.ownerId === viewerUid) return true;
  return stringArrayIncludes(row.ownerManagerIds, viewerUid);
}

/**
 * Prisma WHERE for member-scoped accounts / contacts / deals.
 * Applied in SQL before pagination (same bug class as leads list).
 */
export function ownedMemberScopeWhere(
  viewerUid: string,
): Prisma.AccountWhereInput {
  const uid = viewerUid.trim();
  if (!uid) return { id: "__never__" };
  return {
    OR: [
      { ownerId: uid },
      { payload: { path: ["ownerManagerIds"], array_contains: uid } },
    ],
  };
}

export function encodeCrmListCursor(updatedAt: Date, id: string): string {
  return `${updatedAt.toISOString()}|${id}`;
}

export function decodeCrmListCursor(
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
  const raw =
    typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : CRM_LIST_PAGE_SIZE;
  return Math.max(1, Math.min(CRM_LIST_MAX_PAGE_SIZE, raw));
}

function optionalIso(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  return documentTimestampToIso(value);
}

function cursorWhere(
  organizationId: string,
  decoded: { updatedAt: Date; id: string } | null,
  viewerUid?: string | null,
  narrowToMember?: boolean,
  filterClause?: Prisma.AccountWhereInput,
): Prisma.AccountWhereInput {
  const narrow = Boolean(narrowToMember) && Boolean(viewerUid?.trim());
  const cursorClause: Prisma.AccountWhereInput | null = decoded
    ? {
        OR: [
          { updatedAt: { lt: decoded.updatedAt } },
          { updatedAt: decoded.updatedAt, id: { lt: decoded.id } },
        ],
      }
    : null;
  const scopeParts: Prisma.AccountWhereInput[] = [
    ...(filterClause && Object.keys(filterClause).length ? [filterClause] : []),
    ...(narrow ? [ownedMemberScopeWhere(viewerUid!)] : []),
    ...(cursorClause ? [cursorClause] : []),
  ];
  return {
    organizationId,
    ...(scopeParts.length ? { AND: scopeParts } : {}),
  };
}

function accountFilterClause(filters: CrmEntityListFilters | undefined): Prisma.AccountWhereInput {
  return accountListFilterWhere(filters);
}

function contactFilterClause(filters: CrmEntityListFilters | undefined): Prisma.ContactWhereInput {
  return contactListFilterWhere(filters);
}

function dealFilterClause(filters: CrmEntityListFilters | undefined): Prisma.DealWhereInput {
  return dealListFilterWhere(filters);
}

function scopedOwnedCountWhere(
  organizationId: string,
  narrow: boolean,
  viewerUid: string,
  filterClause: Prisma.AccountWhereInput,
): Prisma.AccountWhereInput {
  const scopeParts: Prisma.AccountWhereInput[] = [
    ...(Object.keys(filterClause).length ? [filterClause] : []),
    ...(narrow ? [ownedMemberScopeWhere(viewerUid)] : []),
  ];
  return {
    organizationId,
    ...(scopeParts.length ? { AND: scopeParts } : {}),
  };
}

export async function countAccountsInPostgres(
  options: Omit<ListCrmPostgresOptions, "cursor" | "limit">,
): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const organizationId = options.organizationId.trim();
  if (!organizationId) return 0;
  const narrow = Boolean(options.narrowToMember) && Boolean(options.viewerUid?.trim());
  const where = scopedOwnedCountWhere(
    organizationId,
    narrow,
    options.viewerUid ?? "",
    accountFilterClause(options.filters),
  );
  return withOrganizationScope(organizationId, (tx) => tx.account.count({ where }));
}

export async function countContactsInPostgres(
  options: Omit<ListCrmPostgresOptions, "cursor" | "limit">,
): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const organizationId = options.organizationId.trim();
  if (!organizationId) return 0;
  const narrow = Boolean(options.narrowToMember) && Boolean(options.viewerUid?.trim());
  const filterClause = contactFilterClause(options.filters);
  const scopeParts: Prisma.ContactWhereInput[] = [
    ...(Object.keys(filterClause).length ? [filterClause] : []),
    ...(narrow ? [ownedMemberScopeWhere(options.viewerUid!) as Prisma.ContactWhereInput] : []),
  ];
  const where: Prisma.ContactWhereInput = {
    organizationId,
    ...(scopeParts.length ? { AND: scopeParts } : {}),
  };
  return withOrganizationScope(organizationId, (tx) => tx.contact.count({ where }));
}

export async function countDealsInPostgres(
  options: Omit<ListCrmPostgresOptions, "cursor" | "limit">,
): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const organizationId = options.organizationId.trim();
  if (!organizationId) return 0;
  const narrow = Boolean(options.narrowToMember) && Boolean(options.viewerUid?.trim());
  const filterClause = dealFilterClause(options.filters);
  const scopeParts: Prisma.DealWhereInput[] = [
    ...(Object.keys(filterClause).length ? [filterClause] : []),
    ...(narrow ? [ownedMemberScopeWhere(options.viewerUid!) as Prisma.DealWhereInput] : []),
  ];
  const where: Prisma.DealWhereInput = {
    organizationId,
    ...(scopeParts.length ? { AND: scopeParts } : {}),
  };
  return withOrganizationScope(organizationId, (tx) => tx.deal.count({ where }));
}

/** Stage sums for the same tenant/member/filter scope as the deals list. No row payload. */
export async function sumDealsByStageInPostgres(
  options: Omit<ListCrmPostgresOptions, "cursor" | "limit">,
): Promise<Record<string, DealStageSum>> {
  if (!isDatabaseConfigured()) return {};
  const organizationId = options.organizationId.trim();
  if (!organizationId) return {};
  const narrow = Boolean(options.narrowToMember) && Boolean(options.viewerUid?.trim());
  const filterClause = dealFilterClause(options.filters);
  const scopeParts: Prisma.DealWhereInput[] = [
    ...(Object.keys(filterClause).length ? [filterClause] : []),
    ...(narrow ? [ownedMemberScopeWhere(options.viewerUid!) as Prisma.DealWhereInput] : []),
  ];
  const where: Prisma.DealWhereInput = {
    organizationId,
    ...(scopeParts.length ? { AND: scopeParts } : {}),
  };
  const rows = await withOrganizationScope(organizationId, (tx) =>
    tx.deal.groupBy({
      by: ["stage"],
      where,
      _sum: { value: true },
      _count: { _all: true },
    }),
  );
  return mapDealStageGroupSums(rows);
}

export type CrmEntityCounts = {
  leads: number;
  accounts: number;
  contacts: number;
  deals: number;
};

export async function countCrmEntitiesInPostgres(input: {
  organizationId: string;
  narrowToMember?: boolean;
  viewerUid?: string;
}): Promise<CrmEntityCounts> {
  const base = {
    organizationId: input.organizationId,
    narrowToMember: input.narrowToMember,
    viewerUid: input.viewerUid,
  };
  const [leads, accounts, contacts, deals] = await Promise.all([
    countLeadsInPostgres(base),
    countAccountsInPostgres(base),
    countContactsInPostgres(base),
    countDealsInPostgres(base),
  ]);
  return { leads, accounts, contacts, deals };
}

/** Map a dual-written Postgres account row into the workspace `Account` type. */
export function accountFromPostgresRow(row: PrismaAccount): Account {
  const payload = payloadRecord(row.payload);
  const base = {
    ...payload,
    name: row.name,
    domain: row.domain ?? undefined,
    industry: row.industry ?? undefined,
    website: row.website ?? undefined,
    ownerId: row.ownerId,
    contactCount: row.contactCount,
    leadCount: row.leadCount,
    openDealValue: row.openDealValue,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastWebsiteActivityAt: optionalIso(payload.lastWebsiteActivityAt),
  };
  return { ...base, id: row.id } as Account;
}

/** Map a dual-written Postgres contact row into the workspace `Contact` type. */
export function contactFromPostgresRow(row: PrismaContact): Contact {
  const payload = payloadRecord(row.payload);
  const base = {
    ...payload,
    accountId: row.accountId,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: row.fullName,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    title: row.title ?? undefined,
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    emailBouncedAt: optionalIso(payload.emailBouncedAt),
  };
  return { ...base, id: row.id } as Contact;
}

/** Map a dual-written Postgres deal row into the workspace `Deal` type. */
export function dealFromPostgresRow(row: PrismaDeal): Deal {
  const payload = payloadRecord(row.payload);
  const base = {
    ...payload,
    leadId: row.leadId,
    accountId: row.accountId,
    contactId: row.contactId,
    name: row.name,
    stage: row.stage as PipelineStage,
    value: row.value,
    currency: row.currency,
    probability: row.probability,
    expectedCloseDate: row.expectedCloseDate.toISOString(),
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    wonAt: row.wonAt ? row.wonAt.toISOString() : optionalIso(payload.wonAt),
    lostAt: row.lostAt ? row.lostAt.toISOString() : optionalIso(payload.lostAt),
  };
  return { ...base, id: row.id } as Deal;
}

export async function listAccountsPageFromPostgres(
  options: ListCrmPostgresOptions,
): Promise<ListAccountsPostgresPage> {
  if (!isDatabaseConfigured()) {
    return { accounts: [], nextCursor: null, hasMore: false };
  }
  const organizationId = options.organizationId.trim();
  if (!organizationId) return { accounts: [], nextCursor: null, hasMore: false };

  const take = clampPageSize(options.limit);
  const decoded = decodeCrmListCursor(options.cursor);
  const where = cursorWhere(
    organizationId,
    decoded,
    options.viewerUid,
    options.narrowToMember,
    accountFilterClause(options.filters),
  );

  const rows = await withOrganizationScope(organizationId, (tx) =>
    tx.account.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: take + 1,
    }),
  );

  const hasMore = rows.length > take;
  const pageRows = hasMore ? rows.slice(0, take) : rows;
  const accounts = pageRows.map(accountFromPostgresRow);
  const last = pageRows[pageRows.length - 1];
  return {
    accounts,
    nextCursor: hasMore && last ? encodeCrmListCursor(last.updatedAt, last.id) : null,
    hasMore,
  };
}

export async function listContactsPageFromPostgres(
  options: ListCrmPostgresOptions,
): Promise<ListContactsPostgresPage> {
  if (!isDatabaseConfigured()) {
    return { contacts: [], nextCursor: null, hasMore: false };
  }
  const organizationId = options.organizationId.trim();
  if (!organizationId) return { contacts: [], nextCursor: null, hasMore: false };

  const take = clampPageSize(options.limit);
  const decoded = decodeCrmListCursor(options.cursor);
  const narrow = Boolean(options.narrowToMember) && Boolean(options.viewerUid?.trim());
  const cursorClause: Prisma.ContactWhereInput | null = decoded
    ? {
        OR: [
          { updatedAt: { lt: decoded.updatedAt } },
          { updatedAt: decoded.updatedAt, id: { lt: decoded.id } },
        ],
      }
    : null;
  const filterClause = contactFilterClause(options.filters);
  const scopeParts: Prisma.ContactWhereInput[] = [
    ...(Object.keys(filterClause).length ? [filterClause] : []),
    ...(narrow ? [ownedMemberScopeWhere(options.viewerUid!) as Prisma.ContactWhereInput] : []),
    ...(cursorClause ? [cursorClause] : []),
  ];
  const where: Prisma.ContactWhereInput = {
    organizationId,
    ...(scopeParts.length ? { AND: scopeParts } : {}),
  };

  const rows = await withOrganizationScope(organizationId, (tx) =>
    tx.contact.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: take + 1,
    }),
  );

  const hasMore = rows.length > take;
  const pageRows = hasMore ? rows.slice(0, take) : rows;
  const contacts = pageRows.map(contactFromPostgresRow);
  const last = pageRows[pageRows.length - 1];
  return {
    contacts,
    nextCursor: hasMore && last ? encodeCrmListCursor(last.updatedAt, last.id) : null,
    hasMore,
  };
}

export async function listDealsPageFromPostgres(
  options: ListCrmPostgresOptions,
): Promise<ListDealsPostgresPage> {
  if (!isDatabaseConfigured()) {
    return { deals: [], nextCursor: null, hasMore: false };
  }
  const organizationId = options.organizationId.trim();
  if (!organizationId) return { deals: [], nextCursor: null, hasMore: false };

  const take = clampPageSize(options.limit);
  const decoded = decodeCrmListCursor(options.cursor);
  const narrow = Boolean(options.narrowToMember) && Boolean(options.viewerUid?.trim());
  const cursorClause: Prisma.DealWhereInput | null = decoded
    ? {
        OR: [
          { updatedAt: { lt: decoded.updatedAt } },
          { updatedAt: decoded.updatedAt, id: { lt: decoded.id } },
        ],
      }
    : null;
  const filterClause = dealFilterClause(options.filters);
  const scopeParts: Prisma.DealWhereInput[] = [
    ...(Object.keys(filterClause).length ? [filterClause] : []),
    ...(narrow ? [ownedMemberScopeWhere(options.viewerUid!) as Prisma.DealWhereInput] : []),
    ...(cursorClause ? [cursorClause] : []),
  ];
  const where: Prisma.DealWhereInput = {
    organizationId,
    ...(scopeParts.length ? { AND: scopeParts } : {}),
  };

  const rows = await withOrganizationScope(organizationId, (tx) =>
    tx.deal.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: take + 1,
    }),
  );

  const hasMore = rows.length > take;
  const pageRows = hasMore ? rows.slice(0, take) : rows;
  const deals = pageRows.map(dealFromPostgresRow);
  const last = pageRows[pageRows.length - 1];
  return {
    deals,
    nextCursor: hasMore && last ? encodeCrmListCursor(last.updatedAt, last.id) : null,
    hasMore,
  };
}

export async function listAccountsFromPostgres(
  options: Omit<ListCrmPostgresOptions, "cursor" | "limit"> & {
    pageSize?: number;
    maxPages?: number;
  },
): Promise<Account[]> {
  const pageSize = clampPageSize(options.pageSize ?? CRM_LIST_PAGE_SIZE);
  const maxPages = Math.max(
    1,
    Math.min(CRM_LIST_MAX_PAGES, Math.floor(options.maxPages ?? CRM_LIST_MAX_PAGES)),
  );
  const out: Account[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const result = await listAccountsPageFromPostgres({
      organizationId: options.organizationId,
      narrowToMember: options.narrowToMember,
      viewerUid: options.viewerUid,
      limit: pageSize,
      cursor,
    });
    out.push(...result.accounts);
    if (!result.hasMore || !result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return out;
}

export async function listContactsFromPostgres(
  options: Omit<ListCrmPostgresOptions, "cursor" | "limit"> & {
    pageSize?: number;
    maxPages?: number;
  },
): Promise<Contact[]> {
  const pageSize = clampPageSize(options.pageSize ?? CRM_LIST_PAGE_SIZE);
  const maxPages = Math.max(
    1,
    Math.min(CRM_LIST_MAX_PAGES, Math.floor(options.maxPages ?? CRM_LIST_MAX_PAGES)),
  );
  const out: Contact[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const result = await listContactsPageFromPostgres({
      organizationId: options.organizationId,
      narrowToMember: options.narrowToMember,
      viewerUid: options.viewerUid,
      limit: pageSize,
      cursor,
    });
    out.push(...result.contacts);
    if (!result.hasMore || !result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return out;
}

export async function listDealsFromPostgres(
  options: Omit<ListCrmPostgresOptions, "cursor" | "limit"> & {
    pageSize?: number;
    maxPages?: number;
  },
): Promise<Deal[]> {
  const pageSize = clampPageSize(options.pageSize ?? CRM_LIST_PAGE_SIZE);
  const maxPages = Math.max(
    1,
    Math.min(CRM_LIST_MAX_PAGES, Math.floor(options.maxPages ?? CRM_LIST_MAX_PAGES)),
  );
  const out: Deal[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const result = await listDealsPageFromPostgres({
      organizationId: options.organizationId,
      narrowToMember: options.narrowToMember,
      viewerUid: options.viewerUid,
      limit: pageSize,
      cursor,
    });
    out.push(...result.deals);
    if (!result.hasMore || !result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return out;
}

/** Single-entity reads for sole-writer Admin paths (P6.4). */
export async function getAccountFromPostgres(
  organizationId: string,
  id: string,
): Promise<Account | null> {
  if (!isDatabaseConfigured() || !organizationId.trim() || !id.trim()) return null;
  const row = await withOrganizationScope(organizationId, (tx) =>
    tx.account.findFirst({ where: { id, organizationId } }),
  );
  return row ? accountFromPostgresRow(row) : null;
}

export async function getContactFromPostgres(
  organizationId: string,
  id: string,
): Promise<Contact | null> {
  if (!isDatabaseConfigured() || !organizationId.trim() || !id.trim()) return null;
  const row = await withOrganizationScope(organizationId, (tx) =>
    tx.contact.findFirst({ where: { id, organizationId } }),
  );
  return row ? contactFromPostgresRow(row) : null;
}

export async function getLeadFromPostgres(
  organizationId: string,
  id: string,
): Promise<Lead | null> {
  if (!isDatabaseConfigured() || !organizationId.trim() || !id.trim()) return null;
  const row = await withOrganizationScope(organizationId, (tx) =>
    tx.lead.findFirst({ where: { id, organizationId } }),
  );
  return row ? leadFromPostgresRow(row, { slim: false }) : null;
}

/** Lightweight owner lookup for timeline / persist scoping (Phase 4). */
export async function getLeadOwnerIdFromPostgres(
  organizationId: string,
  id: string,
): Promise<string | null> {
  if (!isDatabaseConfigured() || !organizationId.trim() || !id.trim()) return null;
  const row = await withOrganizationScope(organizationId, (tx) =>
    tx.lead.findFirst({
      where: { id, organizationId },
      select: { ownerId: true },
    }),
  );
  return row?.ownerId?.trim() ?? null;
}

export async function getDealFromPostgres(
  organizationId: string,
  id: string,
): Promise<Deal | null> {
  if (!isDatabaseConfigured() || !organizationId.trim() || !id.trim()) return null;
  const row = await withOrganizationScope(organizationId, (tx) =>
    tx.deal.findFirst({ where: { id, organizationId } }),
  );
  return row ? dealFromPostgresRow(row) : null;
}

/** Lookup lead id by denormalized `contactEmail` in payload (Instantly sync). */
export async function findLeadIdByContactEmailPostgres(
  organizationId: string,
  email: string,
): Promise<string | null> {
  const map = await findLeadIdsByContactEmailsPostgres(organizationId, [email]);
  return map.get(email.trim().toLowerCase()) ?? null;
}

/**
 * Batch lead lookup by denormalized `contactEmail`, with contacts.email /
 * personalEmail → lead.contactId fallback. Prefer this over document-shim
 * collection queries — CRM sole-writer keeps live rows in Prisma tables, not
 * `pg_documents`.
 */
export async function findLeadIdsByContactEmailsPostgres(
  organizationId: string,
  emails: readonly string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [
    ...new Set(
      emails
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes("@")),
    ),
  ];
  if (!isDatabaseConfigured() || !organizationId.trim() || unique.length === 0) {
    return map;
  }

  await withOrganizationScope(organizationId, async (tx) => {
    for (let i = 0; i < unique.length; i += 25) {
      const chunk = unique.slice(i, i + 25);
      const rows = await tx.lead.findMany({
        where: {
          organizationId,
          OR: chunk.map((email) => ({
            payload: { path: ["contactEmail"], equals: email },
          })),
        },
        select: { id: true, payload: true },
      });
      for (const row of rows) {
        const email = String(
          (row.payload as Record<string, unknown>).contactEmail ?? "",
        )
          .trim()
          .toLowerCase();
        if (email && !map.has(email)) map.set(email, row.id);
      }
    }

    const missing = unique.filter((e) => !map.has(e));
    if (missing.length === 0) return;

    const contactEmailToId = new Map<string, string>();
    for (let i = 0; i < missing.length; i += 25) {
      const chunk = missing.slice(i, i + 25);
      const contacts = await tx.contact.findMany({
        where: {
          organizationId,
          OR: [
            { email: { in: chunk, mode: "insensitive" } },
            ...chunk.map((email) => ({
              payload: { path: ["personalEmail"], equals: email },
            })),
          ],
        },
        select: { id: true, email: true, payload: true },
      });
      for (const c of contacts) {
        const email = String(c.email ?? "")
          .trim()
          .toLowerCase();
        const personal = String(
          (c.payload as Record<string, unknown>).personalEmail ?? "",
        )
          .trim()
          .toLowerCase();
        if (email) contactEmailToId.set(email, c.id);
        if (personal) contactEmailToId.set(personal, c.id);
      }
    }

    const contactIds = [...new Set(contactEmailToId.values())];
    if (contactIds.length === 0) return;

    const leadsByContact = await tx.lead.findMany({
      where: {
        organizationId,
        contactId: { in: contactIds },
      },
      select: { id: true, contactId: true },
    });
    const contactIdToLead = new Map(
      leadsByContact.map((l) => [l.contactId, l.id] as const),
    );
    for (const email of missing) {
      if (map.has(email)) continue;
      const contactId = contactEmailToId.get(email);
      if (!contactId) continue;
      const leadId = contactIdToLead.get(contactId);
      if (leadId) map.set(email, leadId);
    }
  });

  return map;
}
