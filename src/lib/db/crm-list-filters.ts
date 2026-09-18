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
};

export type CrmEntityListFilters = {
  q?: string;
  ownerId?: string;
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
  const hasAny =
    Boolean(q) ||
    stages.length > 0 ||
    channels.length > 0 ||
    Boolean(ownerId) ||
    Boolean(intakeKind) ||
    isIdle ||
    activeOnly ||
    archivedOnly;
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
  };
}

export function parseCrmEntityListFilters(url: URL): CrmEntityListFilters | undefined {
  const q = url.searchParams.get("q")?.trim();
  const ownerId = url.searchParams.get("ownerId")?.trim();
  if (!q && !ownerId) return undefined;
  return { q: q || undefined, ownerId: ownerId || undefined };
}

export function leadListFilterWhere(
  filters: LeadListFilters | undefined,
): Prisma.LeadWhereInput {
  if (!filters) return {};
  const parts: Prisma.LeadWhereInput[] = [];
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    parts.push({
      OR: [
        { contactName: { contains: q, mode: "insensitive" } },
        { companyName: { contains: q, mode: "insensitive" } },
      ],
    });
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
  if (parts.length === 0) return {};
  return { AND: parts };
}
