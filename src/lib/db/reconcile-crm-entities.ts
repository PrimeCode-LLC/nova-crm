/**
 * Firestore ↔ Postgres reconcile for accounts/contacts/leads/deals (P2.6–P2.9).
 * Counts + missing ids + sample scalar field diffs.
 */

import type { QueryDocumentSnapshot } from "@/lib/db/document-shim/shim-firestore";

import type { CrmEntity, CrmFirestoreDoc } from "@/lib/db/dual-write-crm";
import {
  accountRowFromFirestore,
  contactRowFromFirestore,
  dealRowFromFirestore,
  leadRowFromFirestore,
} from "@/lib/db/dual-write-crm";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";

const ENTITY_ORDER: CrmEntity[] = ["account", "contact", "lead", "deal"];

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

export type CrmFieldDiff = {
  entity: CrmEntity;
  id: string;
  field: string;
  firestore: unknown;
  postgres: unknown;
};

export type CrmReconcileReport = {
  clean: boolean;
  byEntity: Record<
    CrmEntity,
    {
      firestoreCount: number;
      postgresCount: number;
      missingInPostgres: string[];
      missingInFirestore: string[];
      fieldDiffs: CrmFieldDiff[];
      compared: number;
    }
  >;
  errors: string[];
};

export type CrmReconcileOptions = {
  organizationId?: string;
  sampleLimit?: number;
  pageSize?: number;
  entities?: CrmEntity[];
  onProgress?: (message: string) => void;
};

async function listFirestoreIds(opts: {
  entity: CrmEntity;
  organizationId?: string;
  pageSize: number;
}): Promise<string[]> {
  const db = getAdminDb();
  if (!db) return [];
  const ids: string[] = [];
  let last: QueryDocumentSnapshot | undefined;
  const col = collectionFor(opts.entity);
  for (;;) {
    let q = opts.organizationId
      ? db
          .collection(col)
          .where("organizationId", "==", opts.organizationId)
          .orderBy("__name__")
          .limit(opts.pageSize)
      : db.collection(col).orderBy("__name__").limit(opts.pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) ids.push(d.id);
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < opts.pageSize) break;
  }
  return ids;
}

async function countPostgres(
  entity: CrmEntity,
  organizationId?: string,
): Promise<number> {
  return withRlsBypass(async (tx) => {
    const where = organizationId ? { organizationId } : undefined;
    switch (entity) {
      case "account":
        return tx.account.count({ where });
      case "contact":
        return tx.contact.count({ where });
      case "lead":
        return tx.lead.count({ where });
      case "deal":
        return tx.deal.count({ where });
    }
  });
}

async function listPostgresIds(
  entity: CrmEntity,
  organizationId?: string,
): Promise<string[]> {
  return withRlsBypass(async (tx) => {
    const where = organizationId ? { organizationId } : undefined;
    const select = { id: true } as const;
    switch (entity) {
      case "account":
        return (await tx.account.findMany({ where, select })).map((r) => r.id);
      case "contact":
        return (await tx.contact.findMany({ where, select })).map((r) => r.id);
      case "lead":
        return (await tx.lead.findMany({ where, select })).map((r) => r.id);
      case "deal":
        return (await tx.deal.findMany({ where, select })).map((r) => r.id);
    }
  });
}

function compareMapped(
  entity: CrmEntity,
  id: string,
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  fields: string[],
): CrmFieldDiff[] {
  const diffs: CrmFieldDiff[] = [];
  for (const field of fields) {
    const a = expected[field] ?? null;
    const b = actual[field] ?? null;
    if (Object.is(a, b)) continue;
    if (a == null && b == null) continue;
    diffs.push({ entity, id, field, firestore: a, postgres: b });
  }
  return diffs;
}

export async function runCrmEntitiesReconcile(
  options: CrmReconcileOptions = {},
): Promise<CrmReconcileReport> {
  const pageSize = Math.max(1, options.pageSize ?? 200);
  const sampleLimit = Math.max(1, options.sampleLimit ?? 50);
  const entities = options.entities?.length ? options.entities : ENTITY_ORDER;
  const log = options.onProgress ?? (() => undefined);

  const emptyEntity = () => ({
    firestoreCount: 0,
    postgresCount: 0,
    missingInPostgres: [] as string[],
    missingInFirestore: [] as string[],
    fieldDiffs: [] as CrmFieldDiff[],
    compared: 0,
  });

  const report: CrmReconcileReport = {
    clean: false,
    byEntity: {
      account: emptyEntity(),
      contact: emptyEntity(),
      lead: emptyEntity(),
      deal: emptyEntity(),
    },
    errors: [],
  };

  if (!isDatabaseConfigured()) {
    report.errors.push("DATABASE_URL is not set.");
    return report;
  }
  if (!getAdminDb()) {
    report.errors.push("Document store is not configured (DATABASE_URL missing).");
    return report;
  }

  const db = getAdminDb()!;

  for (const entity of ENTITY_ORDER) {
    if (!entities.includes(entity)) continue;
    log(`--- reconcile ${entity} ---`);
    try {
      const fsIds = await listFirestoreIds({
        entity,
        organizationId: options.organizationId,
        pageSize,
      });
      const pgIds = await listPostgresIds(entity, options.organizationId);
      const fsSet = new Set(fsIds);
      const pgSet = new Set(pgIds);
      const row = report.byEntity[entity];
      row.firestoreCount = fsIds.length;
      row.postgresCount =
        options.organizationId != null
          ? pgIds.length
          : await countPostgres(entity, options.organizationId);

      for (const id of fsIds) {
        if (!pgSet.has(id)) row.missingInPostgres.push(id);
      }
      for (const id of pgIds) {
        if (!fsSet.has(id)) row.missingInFirestore.push(id);
      }

      const sample = fsIds.filter((id) => pgSet.has(id)).slice(0, sampleLimit);
      for (const id of sample) {
        const snap = await db.collection(collectionFor(entity)).doc(id).get();
        if (!snap.exists) continue;
        const fs = snap.data() as Record<string, unknown>;
        const pgRow = await withRlsBypass(async (tx) => {
          switch (entity) {
            case "account":
              return tx.account.findUnique({ where: { id } });
            case "contact":
              return tx.contact.findUnique({ where: { id } });
            case "lead":
              return tx.lead.findUnique({ where: { id } });
            case "deal":
              return tx.deal.findUnique({ where: { id } });
          }
        });
        if (!pgRow) continue;
        row.compared += 1;
        const pg = pgRow as unknown as Record<string, unknown>;
        const fsDoc = fs as CrmFirestoreDoc;
        try {
          if (entity === "account") {
            const expected = accountRowFromFirestore(id, fsDoc);
            row.fieldDiffs.push(
              ...compareMapped(
                entity,
                id,
                expected as unknown as Record<string, unknown>,
                pg,
                ["name", "ownerId", "contactCount", "leadCount"],
              ),
            );
          } else if (entity === "contact") {
            const expected = contactRowFromFirestore(id, fsDoc);
            row.fieldDiffs.push(
              ...compareMapped(
                entity,
                id,
                expected as unknown as Record<string, unknown>,
                pg,
                ["accountId", "fullName", "email", "ownerId"],
              ),
            );
          } else if (entity === "lead") {
            const expected = leadRowFromFirestore(id, fsDoc);
            row.fieldDiffs.push(
              ...compareMapped(
                entity,
                id,
                expected as unknown as Record<string, unknown>,
                pg,
                [
                  "accountId",
                  "contactId",
                  "stage",
                  "channel",
                  "ownerId",
                  "companyName",
                ],
              ),
            );
          } else {
            const expected = dealRowFromFirestore(id, fsDoc);
            row.fieldDiffs.push(
              ...compareMapped(
                entity,
                id,
                expected as unknown as Record<string, unknown>,
                pg,
                ["leadId", "stage", "value", "ownerId"],
              ),
            );
          }
        } catch (err) {
          report.errors.push(
            `${entity}/${id} map: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      log(
        `${entity}: fs=${row.firestoreCount} pg=${row.postgresCount} missingPg=${row.missingInPostgres.length} missingFs=${row.missingInFirestore.length} diffs=${row.fieldDiffs.length}`,
      );
    } catch (err) {
      report.errors.push(
        `${entity}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  report.clean =
    report.errors.length === 0 &&
    ENTITY_ORDER.every((e) => {
      if (!entities.includes(e)) return true;
      const r = report.byEntity[e];
      return (
        r.firestoreCount === r.postgresCount &&
        r.missingInPostgres.length === 0 &&
        r.missingInFirestore.length === 0 &&
        r.fieldDiffs.length === 0
      );
    });

  return report;
}
