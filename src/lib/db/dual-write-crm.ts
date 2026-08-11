/**
 * Firestore → Postgres dual-write for accounts / contacts / leads / deals (P2.6–P2.9).
 *
 * Stores query columns + full `payload` JSON. Uses RLS bypass (ETL/platform pattern).
 * Failures are logged and never fail the Firestore path.
 */

import type { Prisma } from "@/generated/prisma/client";
import { isPostgresDualWriteCrmEnabled } from "@/lib/db/dual-write-crm-flags";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";

export type CrmEntity = "account" | "contact" | "lead" | "deal";

export type CrmFirestoreDoc = Record<string, unknown> & {
  organizationId?: string;
};

function toDate(value: unknown, fallback = new Date()): Date {
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

function collectionFor(entity: CrmEntity): string {
  switch (entity) {
    case "account":
      return COLLECTIONS.accounts;
    case "contact":
      return COLLECTIONS.contacts;
    case "lead":
      return COLLECTIONS.leads;
    case "deal":
      return COLLECTIONS.deals;
  }
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

export async function upsertAccountMirror(
  id: string,
  data: CrmFirestoreDoc,
): Promise<void> {
  const row = accountRowFromFirestore(id, data);
  await withRlsBypass(async (tx) => {
    await tx.account.upsert({
      where: { id },
      create: row,
      update: {
        organizationId: row.organizationId,
        name: row.name,
        domain: row.domain,
        industry: row.industry,
        website: row.website,
        ownerId: row.ownerId,
        contactCount: row.contactCount,
        leadCount: row.leadCount,
        openDealValue: row.openDealValue,
        payload: row.payload,
        updatedAt: row.updatedAt,
      },
    });
  });
}

export async function upsertContactMirror(
  id: string,
  data: CrmFirestoreDoc,
): Promise<void> {
  const row = contactRowFromFirestore(id, data);
  await withRlsBypass(async (tx) => {
    await tx.contact.upsert({
      where: { id },
      create: row,
      update: {
        organizationId: row.organizationId,
        accountId: row.accountId,
        firstName: row.firstName,
        lastName: row.lastName,
        fullName: row.fullName,
        email: row.email,
        phone: row.phone,
        title: row.title,
        ownerId: row.ownerId,
        payload: row.payload,
        updatedAt: row.updatedAt,
      },
    });
  });
}

export async function upsertLeadMirror(
  id: string,
  data: CrmFirestoreDoc,
): Promise<void> {
  const row = leadRowFromFirestore(id, data);
  await withRlsBypass(async (tx) => {
    await tx.lead.upsert({
      where: { id },
      create: row,
      update: {
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
        intakeKind: row.intakeKind,
        touches: row.touches,
        isIdle: row.isIdle,
        archivedAt: row.archivedAt,
        payload: row.payload,
        updatedAt: row.updatedAt,
      },
    });
  });
}

export async function upsertDealMirror(
  id: string,
  data: CrmFirestoreDoc,
): Promise<void> {
  const row = dealRowFromFirestore(id, data);
  await withRlsBypass(async (tx) => {
    await tx.deal.upsert({
      where: { id },
      create: row,
      update: {
        organizationId: row.organizationId,
        leadId: row.leadId,
        accountId: row.accountId,
        contactId: row.contactId,
        name: row.name,
        stage: row.stage,
        value: row.value,
        currency: row.currency,
        probability: row.probability,
        expectedCloseDate: row.expectedCloseDate,
        ownerId: row.ownerId,
        wonAt: row.wonAt,
        lostAt: row.lostAt,
        payload: row.payload,
        updatedAt: row.updatedAt,
      },
    });
  });
}

export async function deleteCrmMirror(
  entity: CrmEntity,
  id: string,
): Promise<void> {
  await withRlsBypass(async (tx) => {
    switch (entity) {
      case "account":
        await tx.account.deleteMany({ where: { id } });
        break;
      case "contact":
        await tx.contact.deleteMany({ where: { id } });
        break;
      case "lead":
        await tx.lead.deleteMany({ where: { id } });
        break;
      case "deal":
        await tx.deal.deleteMany({ where: { id } });
        break;
    }
  });
}

export async function upsertCrmMirror(
  entity: CrmEntity,
  id: string,
  data: CrmFirestoreDoc,
): Promise<void> {
  switch (entity) {
    case "account":
      await upsertAccountMirror(id, data);
      break;
    case "contact":
      await upsertContactMirror(id, data);
      break;
    case "lead":
      await upsertLeadMirror(id, data);
      break;
    case "deal":
      await upsertDealMirror(id, data);
      break;
  }
}

/** Re-read from Firestore Admin and upsert (or delete if missing). */
export async function mirrorCrmEntityAfterWrite(
  entity: CrmEntity,
  id: string,
  opts?: { organizationId?: string },
): Promise<void> {
  if (!isPostgresDualWriteCrmEnabled() || !isDatabaseConfigured()) return;
  try {
    const db = getAdminDb();
    if (!db) return;
    const snap = await db.collection(collectionFor(entity)).doc(id).get();
    if (!snap.exists) {
      await deleteCrmMirror(entity, id);
      return;
    }
    const data = snap.data() as CrmFirestoreDoc;
    if (
      opts?.organizationId &&
      data.organizationId &&
      data.organizationId !== opts.organizationId
    ) {
      console.error(
        "[dual-write-crm] org mismatch",
        entity,
        id,
        data.organizationId,
        opts.organizationId,
      );
      return;
    }
    await upsertCrmMirror(entity, id, data);
  } catch (err) {
    console.error(
      "[dual-write-crm] mirror failed",
      entity,
      id,
      err instanceof Error ? err.message : err,
    );
  }
}

/** Upsert from an in-memory doc (server create paths). */
export async function mirrorCrmDocAfterWrite(
  entity: CrmEntity,
  id: string,
  data: CrmFirestoreDoc,
): Promise<void> {
  if (!isPostgresDualWriteCrmEnabled() || !isDatabaseConfigured()) return;
  try {
    await upsertCrmMirror(entity, id, data);
  } catch (err) {
    console.error(
      "[dual-write-crm] doc mirror failed",
      entity,
      id,
      err instanceof Error ? err.message : err,
    );
  }
}
