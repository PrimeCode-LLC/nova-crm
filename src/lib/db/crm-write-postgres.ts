/**
 * Postgres sole-writer CRM mutations (P6.2).
 * Tenant-scoped via RLS (`withOrganizationScope`) — not RLS bypass.
 */

import type { Prisma } from "@/generated/prisma/client";
import {
  accountRowFromFirestore,
  contactRowFromFirestore,
  dealRowFromFirestore,
  leadRowFromFirestore,
  type CrmEntity,
  type CrmFirestoreDoc,
} from "@/lib/db/crm-types";
import { scheduleOrgDashboardSummaryRefresh } from "@/lib/db/org-dashboard-summary-refresh";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { withOrganizationScope, type TenantTx } from "@/lib/db/tenant-scope";

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return { ...(payload as Record<string, unknown>) };
  }
  return {};
}

function rowFromDoc(
  entity: CrmEntity,
  id: string,
  data: CrmFirestoreDoc,
): Prisma.AccountUncheckedCreateInput | Prisma.ContactUncheckedCreateInput | Prisma.LeadUncheckedCreateInput | Prisma.DealUncheckedCreateInput {
  switch (entity) {
    case "account":
      return accountRowFromFirestore(id, data);
    case "contact":
      return contactRowFromFirestore(id, data);
    case "lead":
      return leadRowFromFirestore(id, data);
    case "deal":
      return dealRowFromFirestore(id, data);
  }
}

async function findExisting(
  tx: TenantTx,
  entity: CrmEntity,
  id: string,
  opts?: { forUpdate?: boolean },
): Promise<{ organizationId: string; payload: unknown; touches?: number; leadCount?: number } | null> {
  // Serialize concurrent payload merges on the same row (same class of bug as
  // the document-store lost-update: last writer would drop the other's fields).
  if (opts?.forUpdate) {
    switch (entity) {
      case "account":
        await tx.$executeRaw`SELECT 1 FROM accounts WHERE id = ${id} FOR UPDATE`;
        break;
      case "contact":
        await tx.$executeRaw`SELECT 1 FROM contacts WHERE id = ${id} FOR UPDATE`;
        break;
      case "lead":
        await tx.$executeRaw`SELECT 1 FROM leads WHERE id = ${id} FOR UPDATE`;
        break;
      case "deal":
        await tx.$executeRaw`SELECT 1 FROM deals WHERE id = ${id} FOR UPDATE`;
        break;
    }
  }
  switch (entity) {
    case "account": {
      const row = await tx.account.findUnique({ where: { id } });
      return row
        ? { organizationId: row.organizationId, payload: row.payload, leadCount: row.leadCount }
        : null;
    }
    case "contact": {
      const row = await tx.contact.findUnique({ where: { id } });
      return row ? { organizationId: row.organizationId, payload: row.payload } : null;
    }
    case "lead": {
      const row = await tx.lead.findUnique({ where: { id } });
      return row
        ? { organizationId: row.organizationId, payload: row.payload, touches: row.touches }
        : null;
    }
    case "deal": {
      const row = await tx.deal.findUnique({ where: { id } });
      return row ? { organizationId: row.organizationId, payload: row.payload } : null;
    }
  }
}

async function upsertInTx(
  tx: TenantTx,
  entity: CrmEntity,
  id: string,
  data: CrmFirestoreDoc,
): Promise<void> {
  switch (entity) {
    case "account": {
      const row = accountRowFromFirestore(id, data);
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
      return;
    }
    case "contact": {
      const row = contactRowFromFirestore(id, data);
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
          timezone: row.timezone,
          ownerId: row.ownerId,
          payload: row.payload,
          updatedAt: row.updatedAt,
        },
      });
      return;
    }
    case "lead": {
      const row = leadRowFromFirestore(id, data);
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
      return;
    }
    case "deal": {
      const row = dealRowFromFirestore(id, data);
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
    }
  }
}

function maybeRefreshSummary(entity: CrmEntity, organizationId: string): void {
  if (entity !== "lead" && entity !== "deal") return;
  scheduleOrgDashboardSummaryRefresh(organizationId);
}

export type CrmWriteResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/** Full-document upsert (create or replace payload). */
export async function upsertCrmEntityPostgres(
  organizationId: string,
  entity: CrmEntity,
  id: string,
  doc: Record<string, unknown>,
): Promise<CrmWriteResult> {
  if (!isDatabaseConfigured()) {
    return { ok: false, status: 503, error: "DATABASE_URL is not configured" };
  }
  const data: CrmFirestoreDoc = {
    ...doc,
    organizationId,
    updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : new Date().toISOString(),
    createdAt:
      typeof doc.createdAt === "string" ? doc.createdAt : new Date().toISOString(),
  };
  // Validate row shape early (throws on missing organizationId — already set).
  rowFromDoc(entity, id, data);

  await withOrganizationScope(organizationId, async (tx) => {
    await upsertInTx(tx, entity, id, data);
  });
  maybeRefreshSummary(entity, organizationId);
  return { ok: true };
}

/** Merge patch into existing Postgres payload, then upsert. */
export async function patchCrmEntityPostgres(
  organizationId: string,
  entity: CrmEntity,
  id: string,
  patch: Record<string, unknown>,
  unset: string[] = [],
): Promise<CrmWriteResult> {
  if (!isDatabaseConfigured()) {
    return { ok: false, status: 503, error: "DATABASE_URL is not configured" };
  }

  const result = await withOrganizationScope(organizationId, async (tx) => {
    const existing = await findExisting(tx, entity, id, { forUpdate: true });
    if (!existing) {
      return { ok: false as const, status: 404, error: `${entity} not found` };
    }
    if (existing.organizationId !== organizationId) {
      return { ok: false as const, status: 403, error: "organization mismatch" };
    }

    const merged = payloadRecord(existing.payload);
    for (const [key, val] of Object.entries(patch)) {
      if (key === "id" || key === "createdAt") continue;
      merged[key] = val;
    }
    for (const key of unset) {
      if (key === "id" || key === "organizationId") continue;
      delete merged[key];
    }
    merged.organizationId = organizationId;
    merged.updatedAt = new Date().toISOString();
    if (!merged.createdAt) {
      merged.createdAt = new Date().toISOString();
    }

    await upsertInTx(tx, entity, id, merged);
    return { ok: true as const };
  });

  if (result.ok) maybeRefreshSummary(entity, organizationId);
  return result;
}

/** Delete entity; optionally decrement account.leadCount (lead deletes). */
export async function deleteCrmEntityPostgres(
  organizationId: string,
  entity: CrmEntity,
  id: string,
  opts?: { accountId?: string; accountLeadCount?: number },
): Promise<CrmWriteResult> {
  if (!isDatabaseConfigured()) {
    return { ok: false, status: 503, error: "DATABASE_URL is not configured" };
  }

  const result = await withOrganizationScope(organizationId, async (tx) => {
    const existing = await findExisting(tx, entity, id);
    if (existing && existing.organizationId !== organizationId) {
      return { ok: false as const, status: 403, error: "organization mismatch" };
    }

    switch (entity) {
      case "account":
        await tx.account.deleteMany({ where: { id, organizationId } });
        break;
      case "contact":
        await tx.contact.deleteMany({ where: { id, organizationId } });
        break;
      case "lead":
        await tx.lead.deleteMany({ where: { id, organizationId } });
        break;
      case "deal":
        await tx.deal.deleteMany({ where: { id, organizationId } });
        break;
    }

    if (entity === "lead" && opts?.accountId) {
      const accountId = opts.accountId;
      await tx.$executeRaw`SELECT 1 FROM accounts WHERE id = ${accountId} FOR UPDATE`;
      const account = await tx.account.findUnique({ where: { id: accountId } });
      if (account && account.organizationId === organizationId) {
        const nextCount =
          typeof opts.accountLeadCount === "number"
            ? Math.max(0, opts.accountLeadCount)
            : Math.max(0, account.leadCount - 1);
        const payload = payloadRecord(account.payload);
        payload.leadCount = nextCount;
        payload.updatedAt = new Date().toISOString();
        await tx.account.update({
          where: { id: accountId },
          data: {
            leadCount: nextCount,
            payload: payload as Prisma.InputJsonValue,
            updatedAt: new Date(),
          },
        });
      }
    }

    return { ok: true as const };
  });

  if (result.ok) maybeRefreshSummary(entity, organizationId);
  return result;
}

/** Atomic account + contact + lead create (lead graph). */
export async function upsertLeadGraphPostgres(
  organizationId: string,
  input: {
    account: { id: string; doc: Record<string, unknown> };
    contact: { id: string; doc: Record<string, unknown> };
    lead: { id: string; doc: Record<string, unknown> };
  },
): Promise<CrmWriteResult> {
  if (!isDatabaseConfigured()) {
    return { ok: false, status: 503, error: "DATABASE_URL is not configured" };
  }

  const stamp = (doc: Record<string, unknown>): CrmFirestoreDoc => ({
    ...doc,
    organizationId,
    updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : new Date().toISOString(),
    createdAt: typeof doc.createdAt === "string" ? doc.createdAt : new Date().toISOString(),
  });

  const accountDoc = stamp(input.account.doc);
  const contactDoc = stamp(input.contact.doc);
  const leadDoc = stamp(input.lead.doc);
  rowFromDoc("account", input.account.id, accountDoc);
  rowFromDoc("contact", input.contact.id, contactDoc);
  rowFromDoc("lead", input.lead.id, leadDoc);

  await withOrganizationScope(organizationId, async (tx) => {
    await upsertInTx(tx, "account", input.account.id, accountDoc);
    await upsertInTx(tx, "contact", input.contact.id, contactDoc);
    await upsertInTx(tx, "lead", input.lead.id, leadDoc);
  });
  maybeRefreshSummary("lead", organizationId);
  return { ok: true };
}

/** Increment lead touches + lastActivityAt (P6.4 activity bump). */
export async function bumpLeadActivityPostgres(
  organizationId: string,
  leadId: string,
): Promise<CrmWriteResult> {
  if (!isDatabaseConfigured()) {
    return { ok: false, status: 503, error: "DATABASE_URL is not configured" };
  }
  const result = await withOrganizationScope(organizationId, async (tx) => {
    const row = await findExisting(tx, "lead", leadId, { forUpdate: true });
    if (!row || row.organizationId !== organizationId) {
      return { ok: false as const, status: 404, error: "lead not found" };
    }
    const merged = payloadRecord(row.payload);
    const touches = Math.max(0, Math.floor(Number(merged.touches ?? row.touches) || 0)) + 1;
    const now = new Date().toISOString();
    merged.touches = touches;
    merged.lastActivityAt = now;
    merged.updatedAt = now;
    merged.organizationId = organizationId;
    await upsertInTx(tx, "lead", leadId, merged);
    return { ok: true as const };
  });
  if (result.ok) maybeRefreshSummary("lead", organizationId);
  return result;
}
