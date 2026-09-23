import type { Prisma } from "@/generated/prisma/client";

/** Phase 5 — optional server-side lead list filters (query params). */
export type LeadListFilters = {
  q?: string;
  stages?: string[];
  channels?: string[];
  ownerId?: string;
  intakeKind?: string;
  activeOnly?: boolean;
  archivedOnly?: boolean;
  isIdle?: boolean;
  /** Column filters — omitted means no extra predicate (existing callers unchanged). */
  accountId?: string;
  contactId?: string;
  /** Payload field `campaignId`. */
  campaignId?: string;
  /** Batch by-id. Capped at 100. */
  ids?: string[];
  /** ISO lower bound on payload `lastReplyAt`. */
  repliedSince?: string;
  /** ISO lower bound on `createdAt`. */
  createdSince?: string;
  /**
   * Payload `replyReviewStatus` equals. Superset of `hasPendingReplyReview`
   * (stage and hard-no rules stay on the client). Omitted = no predicate.
   * JSON path filters are unindexed; callers must stay off hot loops.
   */
  replyReviewStatus?: string;
  /**
   * Payload `replyActionStatus` equals. Superset of `hasPendingReplyAction`
   * (`pendingReplyActionId` stays on the client). Omitted = no predicate.
   */
  replyActionStatus?: string;
  /** Column `companyName` case-insensitive equals. Takes precedence over `q` on that column. */
  companyNameExact?: string;
  /** Payload `companyDomain` equals. Omitted = no predicate. */
  companyDomain?: string;
};

export type CrmEntityListFilters = {
  q?: string;
  ownerId?: string;
  accountId?: string;
  contactId?: string;
  leadId?: string;
  ids?: string[];
};

export function parseLeadListFilters(url: URL): LeadListFilters | undefined {
  const q = url.searchParams.get("q")?.trim();
  const stages = url.searchParams.getAll("stage").filter(Boolean);
  const channels = url.searchParams.getAll("channel").filter(Boolean);
  const ownerId = url.searchParams.get("ownerId")?.trim();
  const intakeKind = url.searchParams.get("intakeKind")?.trim();
  const isIdle = url.searchParams.get("isIdle") === "1";
  const activeOnly = url.searchParams.get("activeOnly") === "1";
  const archivedOnly = url.searchParams.get("archivedOnly") === "1";
  const accountId = url.searchParams.get("accountId")?.trim();
  const contactId = url.searchParams.get("contactId")?.trim();
  const campaignId = url.searchParams.get("campaignId")?.trim();
  const repliedSince = url.searchParams.get("repliedSince")?.trim();
  const createdSince = url.searchParams.get("createdSince")?.trim();
  const replyReviewStatus = url.searchParams.get("replyReviewStatus")?.trim();
  const replyActionStatus = url.searchParams.get("replyActionStatus")?.trim();
  const companyNameExact = url.searchParams.get("companyNameExact")?.trim();
  const companyDomain = url.searchParams.get("companyDomain")?.trim();
  const ids = parseIdList(url.searchParams.get("ids"));
  const hasAny =
    Boolean(q) ||
    stages.length > 0 ||
    channels.length > 0 ||
    Boolean(ownerId) ||
    Boolean(intakeKind) ||
    isIdle ||
    activeOnly ||
    archivedOnly ||
    Boolean(accountId) ||
    Boolean(contactId) ||
    Boolean(campaignId) ||
    Boolean(repliedSince) ||
    Boolean(createdSince) ||
    Boolean(replyReviewStatus) ||
    Boolean(replyActionStatus) ||
    Boolean(companyNameExact) ||
    Boolean(companyDomain) ||
    ids.length > 0;
  if (!hasAny) return undefined;
  return {
    q: q || undefined,
    stages: stages.length ? stages : undefined,
    channels: channels.length ? channels : undefined,
    ownerId: ownerId || undefined,
    intakeKind: intakeKind || undefined,
    isIdle: isIdle || undefined,
    activeOnly: activeOnly || undefined,
    archivedOnly: archivedOnly || undefined,
    accountId: accountId || undefined,
    contactId: contactId || undefined,
    campaignId: campaignId || undefined,
    repliedSince: repliedSince || undefined,
    createdSince: createdSince || undefined,
    replyReviewStatus: replyReviewStatus || undefined,
    replyActionStatus: replyActionStatus || undefined,
    companyNameExact: companyNameExact || undefined,
    companyDomain: companyDomain || undefined,
    ids: ids.length ? ids : undefined,
  };
}

const ID_LIST_CAP = 100;

function parseIdList(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.slice(0, ID_LIST_CAP);
}

export function parseCrmEntityListFilters(url: URL): CrmEntityListFilters | undefined {
  const q = url.searchParams.get("q")?.trim();
  const ownerId = url.searchParams.get("ownerId")?.trim();
  const accountId = url.searchParams.get("accountId")?.trim();
  const contactId = url.searchParams.get("contactId")?.trim();
  const leadId = url.searchParams.get("leadId")?.trim();
  const ids = parseIdList(url.searchParams.get("ids"));
  if (!q && !ownerId && !accountId && !contactId && !leadId && ids.length === 0) return undefined;
  return {
    q: q || undefined,
    ownerId: ownerId || undefined,
    accountId: accountId || undefined,
    contactId: contactId || undefined,
    leadId: leadId || undefined,
    ids: ids.length ? ids : undefined,
  };
}

export function leadListFilterWhere(
  filters: LeadListFilters | undefined,
): Prisma.LeadWhereInput {
  if (!filters) return {};
  const parts: Prisma.LeadWhereInput[] = [];
  const companyNameExact = filters.companyNameExact?.trim();
  if (companyNameExact) {
    parts.push({ companyName: { equals: companyNameExact, mode: "insensitive" } });
  }
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    // Exact company match owns the company column so `q` cannot widen it.
    const or: Prisma.LeadWhereInput[] = [
      { contactName: { contains: q, mode: "insensitive" } },
    ];
    if (!companyNameExact) {
      or.push({ companyName: { contains: q, mode: "insensitive" } });
    }
    parts.push({ OR: or });
  }
  if (filters.stages?.length) parts.push({ stage: { in: filters.stages } });
  if (filters.channels?.length) parts.push({ channel: { in: filters.channels } });
  if (filters.ownerId?.trim()) parts.push({ ownerId: filters.ownerId.trim() });
  if (filters.intakeKind === "sales_lead") {
    parts.push({ OR: [{ intakeKind: null }, { intakeKind: "sales_lead" }] });
  } else if (filters.intakeKind?.trim()) {
    parts.push({ intakeKind: filters.intakeKind.trim() });
  }
  if (filters.activeOnly) parts.push({ archivedAt: null });
  if (filters.archivedOnly) parts.push({ archivedAt: { not: null } });
  if (filters.isIdle === true) parts.push({ isIdle: true });
  if (filters.accountId?.trim()) parts.push({ accountId: filters.accountId.trim() });
  if (filters.contactId?.trim()) parts.push({ contactId: filters.contactId.trim() });
  if (filters.campaignId?.trim()) {
    parts.push({
      payload: { path: ["campaignId"], equals: filters.campaignId.trim() },
    });
  }
  if (filters.replyReviewStatus?.trim()) {
    parts.push({
      payload: { path: ["replyReviewStatus"], equals: filters.replyReviewStatus.trim() },
    });
  }
  if (filters.replyActionStatus?.trim()) {
    parts.push({
      payload: { path: ["replyActionStatus"], equals: filters.replyActionStatus.trim() },
    });
  }
  if (filters.companyDomain?.trim()) {
    parts.push({
      payload: { path: ["companyDomain"], equals: filters.companyDomain.trim() },
    });
  }
  if (filters.ids?.length) parts.push({ id: { in: filters.ids.slice(0, 100) } });
  if (filters.repliedSince?.trim()) {
    parts.push({
      payload: { path: ["lastReplyAt"], gte: filters.repliedSince.trim() },
    });
  }
  if (filters.createdSince?.trim()) {
    const created = new Date(filters.createdSince.trim());
    if (!Number.isNaN(created.getTime())) {
      parts.push({ createdAt: { gte: created } });
    }
  }
  if (parts.length === 0) return {};
  return { AND: parts };
}

export function accountListFilterWhere(
  filters: CrmEntityListFilters | undefined,
): Prisma.AccountWhereInput {
  if (!filters) return {};
  const parts: Prisma.AccountWhereInput[] = [];
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    parts.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { domain: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (filters.ownerId?.trim()) parts.push({ ownerId: filters.ownerId.trim() });
  if (filters.ids?.length) parts.push({ id: { in: filters.ids.slice(0, 100) } });
  if (parts.length === 0) return {};
  return { AND: parts };
}

export function contactListFilterWhere(
  filters: CrmEntityListFilters | undefined,
): Prisma.ContactWhereInput {
  if (!filters) return {};
  const parts: Prisma.ContactWhereInput[] = [];
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    parts.push({
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (filters.ownerId?.trim()) parts.push({ ownerId: filters.ownerId.trim() });
  if (filters.accountId?.trim()) parts.push({ accountId: filters.accountId.trim() });
  if (filters.ids?.length) parts.push({ id: { in: filters.ids.slice(0, 100) } });
  if (parts.length === 0) return {};
  return { AND: parts };
}

export function dealListFilterWhere(
  filters: CrmEntityListFilters | undefined,
): Prisma.DealWhereInput {
  if (!filters) return {};
  const parts: Prisma.DealWhereInput[] = [];
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    parts.push({ name: { contains: q, mode: "insensitive" } });
  }
  if (filters.ownerId?.trim()) parts.push({ ownerId: filters.ownerId.trim() });
  if (filters.accountId?.trim()) parts.push({ accountId: filters.accountId.trim() });
  if (filters.contactId?.trim()) parts.push({ contactId: filters.contactId.trim() });
  if (filters.leadId?.trim()) parts.push({ leadId: filters.leadId.trim() });
  if (filters.ids?.length) parts.push({ id: { in: filters.ids.slice(0, 100) } });
  if (parts.length === 0) return {};
  return { AND: parts };
}
