/**
 * Idempotent Firestore → Postgres ETL for accounts/contacts/leads/deals (P2.6–P2.9).
 * Order: accounts → contacts → leads → deals. Safe to re-run (upserts).
 */

import type { QueryDocumentSnapshot } from "@/lib/db/document-shim/shim-firestore";

import {
  upsertCrmMirror,
  type CrmEntity,
  type CrmFirestoreDoc,
} from "@/lib/db/dual-write-crm";
import { isDatabaseConfigured } from "@/lib/db/prisma";
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

export type CrmEtlStats = {
  dryRun: boolean;
  byEntity: Record<
    CrmEntity,
    { scanned: number; upserted: number }
  >;
  errors: string[];
};

export type CrmEtlOptions = {
  organizationId?: string;
  dryRun?: boolean;
  /** Max docs per entity. */
  limit?: number;
  pageSize?: number;
  entities?: CrmEntity[];
  onProgress?: (message: string) => void;
};

async function* iterateDocs(opts: {
  entity: CrmEntity;
  organizationId?: string;
  pageSize: number;
  limit?: number;
}): AsyncGenerator<{ id: string; data: CrmFirestoreDoc }, void, undefined> {
  const db = getAdminDb();
  if (!db) return;

  const col = collectionFor(opts.entity);
  let yielded = 0;
  let last: QueryDocumentSnapshot | undefined;

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
    for (const doc of snap.docs) {
      yield { id: doc.id, data: doc.data() as CrmFirestoreDoc };
      yielded += 1;
      if (opts.limit != null && yielded >= opts.limit) return;
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < opts.pageSize) break;
  }
}

export async function runCrmEntitiesBackfill(
  options: CrmEtlOptions = {},
): Promise<CrmEtlStats> {
  const dryRun = Boolean(options.dryRun);
  const pageSize = Math.max(1, options.pageSize ?? 100);
  const entities = options.entities?.length ? options.entities : ENTITY_ORDER;
  const log = options.onProgress ?? (() => undefined);

  const stats: CrmEtlStats = {
    dryRun,
    byEntity: {
      account: { scanned: 0, upserted: 0 },
      contact: { scanned: 0, upserted: 0 },
      lead: { scanned: 0, upserted: 0 },
      deal: { scanned: 0, upserted: 0 },
    },
    errors: [],
  };

  if (!isDatabaseConfigured()) {
    stats.errors.push("DATABASE_URL is not set (nova_app — see docs/ENVIRONMENTS.md).");
    return stats;
  }
  if (!getAdminDb()) {
    stats.errors.push("Document store is not configured (FIREBASE_ADMIN_*).");
    return stats;
  }

  for (const entity of ENTITY_ORDER) {
    if (!entities.includes(entity)) continue;
    log(`--- ${entity} ---`);
    for await (const { id, data } of iterateDocs({
      entity,
      organizationId: options.organizationId,
      pageSize,
      limit: options.limit,
    })) {
      stats.byEntity[entity].scanned += 1;
      try {
        if (!data.organizationId) {
          stats.errors.push(`${entity}/${id}: missing organizationId`);
          continue;
        }
        if (!dryRun) {
          await upsertCrmMirror(entity, id, data);
          stats.byEntity[entity].upserted += 1;
        }
        if (stats.byEntity[entity].scanned % 50 === 0) {
          log(`${entity}: scanned ${stats.byEntity[entity].scanned}`);
        }
      } catch (err) {
        stats.errors.push(
          `${entity}/${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    log(
      `${entity} done: scanned=${stats.byEntity[entity].scanned} upserted=${stats.byEntity[entity].upserted}`,
    );
  }

  return stats;
}
