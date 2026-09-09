/**
 * Low-level Postgres document store backing the Firestore shim.
 */

import type { Prisma } from "@/generated/prisma/client";
import {
  accountRowFromFirestore,
  contactRowFromFirestore,
  crmEntityFromCollection,
  dealRowFromFirestore,
  leadRowFromFirestore,
  type CrmFirestoreDoc,
} from "@/lib/db/crm-types";
import { scheduleOrgDashboardSummaryRefresh } from "@/lib/db/org-dashboard-summary-refresh";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import {
  applyFieldValues,
  resolveWriteData,
  serializePayloadValue,
} from "@/lib/db/document-shim/field-values";
import {
  extractOrganizationId,
  isImmediateCollectionDocument,
  parsePath,
  pathMatchesCollectionGroup,
} from "@/lib/db/document-shim/path";
import { deserializePayload } from "@/lib/db/document-shim/timestamp";

export type StoredDoc = {
  path: string;
  organizationId: string | null;
  collectionRoot: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type QueryFilter = {
  field: string;
  op: "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "array-contains";
  value: unknown;
};

export type QuerySpec = {
  collectionRoot?: string;
  /** Firestore collectionGroup id (e.g. `members`). */
  collectionGroup?: string;
  pathPrefix?: string;
  filters: QueryFilter[];
  orderBy?: { field: string; direction: "asc" | "desc" };
  limit?: number;
  startAfter?: unknown[];
};

function matchesFilter(
  payload: Record<string, unknown>,
  filter: QueryFilter,
): boolean {
  const v = payload[filter.field];
  switch (filter.op) {
    case "==":
      return v === filter.value || String(v) === String(filter.value);
    case "!=":
      return v !== filter.value;
    case "in":
      return Array.isArray(filter.value) && filter.value.includes(v);
    case "array-contains":
      return Array.isArray(v) && v.some((x) => x === filter.value);
    case "<":
      return (v as number) < (filter.value as number);
    case "<=":
      return (v as number) <= (filter.value as number);
    case ">":
      return (v as number) > (filter.value as number);
    case ">=":
      return (v as number) >= (filter.value as number);
    default:
      return true;
  }
}

async function syncCrmEntity(
  collectionRoot: string,
  docId: string,
  payload: Record<string, unknown>,
  deleteOnly = false,
): Promise<void> {
  const entity = crmEntityFromCollection(collectionRoot);
  if (!entity || !isDatabaseConfigured()) return;

  const orgId =
    typeof payload.organizationId === "string" ? payload.organizationId : null;

  await withRlsBypass(async (tx) => {
    if (deleteOnly) {
      switch (entity) {
        case "account":
          await tx.account.deleteMany({ where: { id: docId } });
          break;
        case "contact":
          await tx.contact.deleteMany({ where: { id: docId } });
          break;
        case "lead":
          await tx.lead.deleteMany({ where: { id: docId } });
          break;
        case "deal":
          await tx.deal.deleteMany({ where: { id: docId } });
          break;
      }
      if (orgId && (entity === "lead" || entity === "deal")) {
        scheduleOrgDashboardSummaryRefresh(orgId);
      }
      return;
    }

    const data = { ...payload, organizationId: orgId ?? payload.organizationId } as CrmFirestoreDoc;
    switch (entity) {
      case "account": {
        const row = accountRowFromFirestore(docId, data);
        await tx.account.upsert({
          where: { id: docId },
          create: row,
          update: { ...row, id: undefined } as Prisma.AccountUncheckedUpdateInput,
        });
        break;
      }
      case "contact": {
        const row = contactRowFromFirestore(docId, data);
        await tx.contact.upsert({
          where: { id: docId },
          create: row,
          update: { ...row, id: undefined } as Prisma.ContactUncheckedUpdateInput,
        });
        break;
      }
      case "lead": {
        const row = leadRowFromFirestore(docId, data);
        await tx.lead.upsert({
          where: { id: docId },
          create: row,
          update: { ...row, id: undefined } as Prisma.LeadUncheckedUpdateInput,
        });
        break;
      }
      case "deal": {
        const row = dealRowFromFirestore(docId, data);
        await tx.deal.upsert({
          where: { id: docId },
          create: row,
          update: { ...row, id: undefined } as Prisma.DealUncheckedUpdateInput,
        });
        break;
      }
    }
    if (orgId && (entity === "lead" || entity === "deal")) {
      scheduleOrgDashboardSummaryRefresh(orgId);
    }
  });
}

export async function getDocument(path: string): Promise<StoredDoc | null> {
  if (!isDatabaseConfigured()) return null;
  const parsed = parsePath(path);

  // CRM entities: prefer Prisma tables
  const crmEntity = crmEntityFromCollection(parsed.collectionRoot);
  if (crmEntity && parsed.segments.length === 2) {
    const docId = parsed.segments[1]!;
    const row = await withRlsBypass(async (tx) => {
      switch (crmEntity) {
        case "account":
          return tx.account.findUnique({ where: { id: docId } });
        case "contact":
          return tx.contact.findUnique({ where: { id: docId } });
        case "lead":
          return tx.lead.findUnique({ where: { id: docId } });
        case "deal":
          return tx.deal.findUnique({ where: { id: docId } });
      }
    });
    if (row) {
      const payload = deserializePayload({
        ...(row.payload as Record<string, unknown>),
        organizationId: row.organizationId,
        id: docId,
      });
      return {
        path,
        organizationId: row.organizationId,
        collectionRoot: parsed.collectionRoot,
        payload,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    }
  }

  const row = await withRlsBypass((tx) =>
    tx.pgDocument.findUnique({ where: { path } }),
  );
  if (!row) return null;
  return {
    path: row.path,
    organizationId: row.organizationId,
    collectionRoot: row.collectionRoot,
    payload: deserializePayload(row.payload as Record<string, unknown>),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function setDocument(
  path: string,
  data: Record<string, unknown>,
  merge: boolean,
): Promise<void> {
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is not configured");
  }
  const parsed = parsePath(path);
  const resolved = resolveWriteData(data);
  const serialized = serializePayloadValue(resolved) as Record<string, unknown>;

  let payload: Record<string, unknown>;
  if (merge) {
    const existing = await getDocument(path);
    payload = existing
      ? { ...existing.payload, ...serialized }
      : serialized;
  } else {
    payload = serialized;
  }

  const organizationId = extractOrganizationId(
    parsed.collectionRoot,
    parsed.segments,
    payload,
  );

  const crmEntity = crmEntityFromCollection(parsed.collectionRoot);
  if (crmEntity && parsed.segments.length === 2) {
    await syncCrmEntity(parsed.collectionRoot, parsed.segments[1]!, payload);
  }

  const now = new Date();
  await withRlsBypass(async (tx) => {
    await tx.pgDocument.upsert({
      where: { path },
      create: {
        path,
        organizationId,
        collectionRoot: parsed.collectionRoot,
        payload: payload as Prisma.InputJsonValue,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        organizationId,
        payload: payload as Prisma.InputJsonValue,
        updatedAt: now,
      },
    });
  });
}

export async function updateDocument(
  path: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const existing = await getDocument(path);
  if (!existing) {
    throw new Error(`Document ${path} not found`);
  }
  const merged = applyFieldValues(existing.payload, patch);
  await setDocument(path, merged, false);
}

export async function deleteDocument(path: string): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const parsed = parsePath(path);
  const crmEntity = crmEntityFromCollection(parsed.collectionRoot);
  if (crmEntity && parsed.segments.length === 2) {
    await syncCrmEntity(parsed.collectionRoot, parsed.segments[1]!, {}, true);
  }
  await withRlsBypass((tx) =>
    tx.pgDocument.deleteMany({ where: { path } }),
  );
}

/** Delete a document and every nested path under it (`path` and `path/...`). */
export async function deleteDocumentSubtree(path: string): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const prefix = path.replace(/\/+$/, "");
  if (!prefix) return 0;
  const result = await withRlsBypass((tx) =>
    tx.pgDocument.deleteMany({
      where: {
        OR: [{ path: prefix }, { path: { startsWith: `${prefix}/` } }],
      },
    }),
  );
  return result.count;
}

export async function queryDocuments(spec: QuerySpec): Promise<StoredDoc[]> {
  if (!isDatabaseConfigured()) return [];

  const rows = await withRlsBypass((tx) =>
    spec.collectionGroup
      ? tx.pgDocument.findMany()
      : tx.pgDocument.findMany({
          where: {
            collectionRoot: spec.collectionRoot!,
            ...(spec.pathPrefix
              ? { path: { startsWith: spec.pathPrefix } }
              : {}),
          },
        }),
  );

  let docs = rows.map((row) => ({
    path: row.path,
    organizationId: row.organizationId,
    collectionRoot: row.collectionRoot,
    payload: deserializePayload(row.payload as Record<string, unknown>),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  if (spec.collectionGroup) {
    docs = docs.filter((d) =>
      pathMatchesCollectionGroup(d.path, spec.collectionGroup!),
    );
    if (spec.pathPrefix) {
      docs = docs.filter((d) => d.path.startsWith(spec.pathPrefix!));
    }
  } else if (spec.pathPrefix) {
    // Match Firestore collection queries: only immediate docs under the collection path.
    docs = docs.filter((d) => isImmediateCollectionDocument(d.path, spec.pathPrefix!));
  }

  for (const filter of spec.filters) {
    docs = docs.filter((d) => matchesFilter(d.payload, filter));
  }

  if (spec.orderBy) {
    const { field, direction } = spec.orderBy;
    docs.sort((a, b) => {
      const av = a.payload[field];
      const bv = b.payload[field];
      const cmp =
        av instanceof Date && bv instanceof Date
          ? av.getTime() - bv.getTime()
          : String(av ?? "").localeCompare(String(bv ?? ""));
      return direction === "desc" ? -cmp : cmp;
    });
  }

  if (spec.startAfter?.length) {
    const cursor = spec.startAfter;
    const idx = docs.findIndex((d) => {
      if (cursor.length === 1 && typeof cursor[0] === "object" && cursor[0] !== null && "id" in cursor[0]) {
        return d.path.endsWith(`/${(cursor[0] as { id: string }).id}`);
      }
      return false;
    });
    if (idx >= 0) docs = docs.slice(idx + 1);
  }

  if (spec.limit != null) {
    docs = docs.slice(0, spec.limit);
  }

  return docs;
}

export async function listCollectionPaths(
  collectionRoot: string,
  pathPrefix: string,
): Promise<string[]> {
  const docs = await queryDocuments({
    collectionRoot,
    pathPrefix,
    filters: [],
  });
  return docs.map((d) => d.path);
}
