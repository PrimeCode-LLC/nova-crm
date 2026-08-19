/**
 * CRM entity types and Firestore→Postgres row mappers (P7).
 * Extracted from dual-write-crm; Postgres is the sole writer.
 */

import type { Prisma } from "@/generated/prisma/client";

export type CrmEntity = "account" | "contact" | "lead" | "deal";

export type CrmFirestoreDoc = Record<string, unknown> & {
  organizationId?: string;
};

export function toDate(value: unknown, fallback = new Date()): Date {
  if (value == null) return fallback;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? fallback : d;
  }
  if (typeof value === "object" && value !== null && "toDate" in value) {
    try {
      const d = (value as { toDate: () => Date }).toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
    } catch {
      /* ignore */
    }
  }
  return fallback;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strOpt(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

export function accountRowFromFirestore(
  id: string,
  data: CrmFirestoreDoc,
): Prisma.AccountUncheckedCreateInput {
  const organizationId = str(data.organizationId);
  if (!organizationId) throw new Error(`account ${id}: missing organizationId`);
  return {
    id,
    organizationId,
    name: str(data.name, "Untitled"),
    domain: strOpt(data.domain),
    industry: strOpt(data.industry),
    website: strOpt(data.website),
    ownerId: str(data.ownerId),
    contactCount: Math.max(0, Math.floor(num(data.contactCount))),
    leadCount: Math.max(0, Math.floor(num(data.leadCount))),
    openDealValue: num(data.openDealValue),
    payload: toJson(data),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export function contactRowFromFirestore(
  id: string,
  data: CrmFirestoreDoc,
): Prisma.ContactUncheckedCreateInput {
  const organizationId = str(data.organizationId);
  if (!organizationId) throw new Error(`contact ${id}: missing organizationId`);
  return {
    id,
    organizationId,
    accountId: str(data.accountId),
    firstName: str(data.firstName),
    lastName: str(data.lastName),
    fullName: str(data.fullName) || `${str(data.firstName)} ${str(data.lastName)}`.trim(),
    email: strOpt(data.email)?.toLowerCase() ?? null,
    phone: strOpt(data.phone),
    title: strOpt(data.title),
    ownerId: str(data.ownerId),
    payload: toJson(data),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export function leadRowFromFirestore(
  id: string,
  data: CrmFirestoreDoc,
): Prisma.LeadUncheckedCreateInput {
  const organizationId = str(data.organizationId);
  if (!organizationId) throw new Error(`lead ${id}: missing organizationId`);
  return {
    id,
    organizationId,
    accountId: str(data.accountId),
    contactId: str(data.contactId),
    channel: str(data.channel, "other"),
    stage: str(data.stage, "new"),
    temperature: str(data.temperature, "warm"),
    priority: str(data.priority, "medium"),
    ownerId: str(data.ownerId),
    contactName: str(data.contactName),
    companyName: str(data.companyName),
    intakeKind: strOpt(data.intakeKind),
    touches: Math.max(0, Math.floor(num(data.touches))),
    isIdle: bool(data.isIdle),
    archivedAt: data.archivedAt == null ? null : toDate(data.archivedAt),
    payload: toJson(data),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export function dealRowFromFirestore(
  id: string,
  data: CrmFirestoreDoc,
): Prisma.DealUncheckedCreateInput {
  const organizationId = str(data.organizationId);
  if (!organizationId) throw new Error(`deal ${id}: missing organizationId`);
  return {
    id,
    organizationId,
    leadId: str(data.leadId),
    accountId: str(data.accountId),
    contactId: str(data.contactId),
    name: str(data.name, "Deal"),
    stage: str(data.stage, "qualification"),
    value: num(data.value),
    currency: str(data.currency, "USD"),
    probability: Math.max(0, Math.min(100, Math.floor(num(data.probability)))),
    expectedCloseDate: toDate(data.expectedCloseDate),
    ownerId: str(data.ownerId),
    wonAt: data.wonAt == null ? null : toDate(data.wonAt),
    lostAt: data.lostAt == null ? null : toDate(data.lostAt),
    payload: toJson(data),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export function crmEntityFromCollection(collection: string): CrmEntity | null {
  switch (collection) {
    case "accounts":
      return "account";
    case "contacts":
      return "contact";
    case "leads":
      return "lead";
    case "deals":
      return "deal";
    default:
      return null;
  }
}
