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
import { firestoreValueToIso } from "@/lib/firestore/timestamp-util";
import type { Account, Contact, Deal, PipelineStage } from "@/lib/types";

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
  return firestoreValueToIso(value);
}

function cursorWhere(
  organizationId: string,
  decoded: { updatedAt: Date; id: string } | null,
): Prisma.AccountWhereInput {
  return {
    organizationId,
    ...(decoded
      ? {
          OR: [
            { updatedAt: { lt: decoded.updatedAt } },
            { updatedAt: decoded.updatedAt, id: { lt: decoded.id } },
          ],
        }
      : {}),
  };
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
  const where = cursorWhere(organizationId, decoded);

  const rows = await withOrganizationScope(organizationId, (tx) =>
    tx.account.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: take + 1,
    }),
  );

  const hasMore = rows.length > take;
  const pageRows = hasMore ? rows.slice(0, take) : rows;
  let accounts = pageRows.map(accountFromPostgresRow);
  if (options.narrowToMember && options.viewerUid) {
    const uid = options.viewerUid;
    accounts = accounts.filter((a) => ownedMatchesMemberScope(a, uid));
  }
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
  const where = cursorWhere(organizationId, decoded) as Prisma.ContactWhereInput;

  const rows = await withOrganizationScope(organizationId, (tx) =>
    tx.contact.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: take + 1,
    }),
  );

  const hasMore = rows.length > take;
  const pageRows = hasMore ? rows.slice(0, take) : rows;
  let contacts = pageRows.map(contactFromPostgresRow);
  if (options.narrowToMember && options.viewerUid) {
    const uid = options.viewerUid;
    contacts = contacts.filter((c) => ownedMatchesMemberScope(c, uid));
  }
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
  const where = cursorWhere(organizationId, decoded) as Prisma.DealWhereInput;

  const rows = await withOrganizationScope(organizationId, (tx) =>
    tx.deal.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: take + 1,
    }),
  );

  const hasMore = rows.length > take;
  const pageRows = hasMore ? rows.slice(0, take) : rows;
  let deals = pageRows.map(dealFromPostgresRow);
  if (options.narrowToMember && options.viewerUid) {
    const uid = options.viewerUid;
    deals = deals.filter((d) => ownedMatchesMemberScope(d, uid));
  }
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
