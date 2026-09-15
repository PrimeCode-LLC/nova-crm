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
  type CrmEntity,
  type CrmFirestoreDoc,
} from "@/lib/db/crm-types";
import { scheduleOrgDashboardSummaryRefresh } from "@/lib/db/org-dashboard-summary-refresh";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import {
  withOrganizationScope,
  withRlsBypass,
  type TenantTx,
} from "@/lib/db/tenant-scope";
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
import {
  coerceInstantMs,
  deserializePayload,
} from "@/lib/db/document-shim/timestamp";

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
  /**
   * Prefer SQL/RLS tenant scope. When omitted, inferred from an
   * `organizationId ==` filter when present.
   */
  organizationId?: string;
  filters: QueryFilter[];
  orderBy?: { field: string; direction: "asc" | "desc" };
  limit?: number;
  startAfter?: unknown[];
};

function organizationIdFromSpec(spec: QuerySpec): string | undefined {
  if (typeof spec.organizationId === "string" && spec.organizationId.trim()) {
    return spec.organizationId.trim();
  }
  for (const filter of spec.filters) {
    if (
      filter.field === "organizationId" &&
      filter.op === "==" &&
      typeof filter.value === "string" &&
      filter.value.trim()
    ) {
      return filter.value.trim();
    }
  }
  return undefined;
}

function documentMatchesOrganization(
  doc: StoredDoc,
  organizationId: string,
): boolean {
  // Column is authoritative when set (avoids cross-tenant leakage if payload was rewritten).
  if (doc.organizationId != null && doc.organizationId !== "") {
    return doc.organizationId === organizationId;
  }
  const payloadOrg = doc.payload.organizationId;
  return payloadOrg === organizationId || String(payloadOrg ?? "") === organizationId;
}

function compareFilterValues(left: unknown, right: unknown): number | null {
  const leftMs = coerceInstantMs(left);
  const rightMs = coerceInstantMs(right);
  if (leftMs != null && rightMs != null) return leftMs - rightMs;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "string" && typeof right === "string") {
    return left.localeCompare(right);
  }
  // Last resort: avoid `String(Timestamp) === "[object Object]"` false negatives.
  if (leftMs != null || rightMs != null) return null;
  try {
    return String(left ?? "").localeCompare(String(right ?? ""));
  } catch {
    return null;
  }
}

function matchesFilter(
  payload: Record<string, unknown>,
  filter: QueryFilter,
): boolean {
  const v = payload[filter.field];
  switch (filter.op) {
    case "==":
      if (v === filter.value) return true;
      if (String(v) === String(filter.value)) return true;
      return compareFilterValues(v, filter.value) === 0;
    case "!=":
      return !matchesFilter(payload, { ...filter, op: "==" });
    case "in":
      return Array.isArray(filter.value) && filter.value.includes(v);
    case "array-contains":
      return Array.isArray(v) && v.some((x) => x === filter.value);
    case "<":
    case "<=":
    case ">":
    case ">=": {
      const cmp = compareFilterValues(v, filter.value);
      if (cmp == null) return false;
      if (filter.op === "<") return cmp < 0;
      if (filter.op === "<=") return cmp <= 0;
      if (filter.op === ">") return cmp > 0;
      return cmp >= 0;
    }
    default:
      return true;
  }
}

async function syncCrmEntityInTx(
  tx: TenantTx,
  entity: CrmEntity,
  docId: string,
  payload: Record<string, unknown>,
  deleteOnly = false,
): Promise<void> {
  const orgId =
    typeof payload.organizationId === "string" ? payload.organizationId : null;

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
}

async function readDocumentInTx(
  tx: TenantTx,
  path: string,
  parsed: ReturnType<typeof parsePath>,
): Promise<StoredDoc | null> {
  // CRM entities: prefer Prisma tables
  const crmEntity = crmEntityFromCollection(parsed.collectionRoot);
  if (crmEntity && parsed.segments.length === 2) {
    const docId = parsed.segments[1]!;
    const row = await (async () => {
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
    })();
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

  const row = await tx.pgDocument.findUnique({ where: { path } });
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

export async function getDocument(path: string): Promise<StoredDoc | null> {
  if (!isDatabaseConfigured()) return null;
  const parsed = parsePath(path);
  return withRlsBypass((tx) => readDocumentInTx(tx, path, parsed));
}

/**
 * Serialize read-modify-write on one document path.
 *
 * `updateDocument` and `setDocument(merge)` rewrite the whole JSONB payload, so
 * two concurrent patches to the same doc would each read the pre-patch payload
 * and the last writer would silently drop the other's fields. The UI does issue
 * concurrent patches (e.g. reschedule = clear email schedule + set dueAt), which
 * showed up as a followup snapping back to its old due date.
 */
async function lockDocumentPath(tx: TenantTx, path: string): Promise<void> {
  const [high, low] = documentLockKey(path);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${high}::int4, ${low}::int4)`;
}

/** Two independent 32-bit hashes of the path for pg_advisory_xact_lock(int4, int4). */
function documentLockKey(path: string): [number, number] {
  let high = 0x811c9dc5;
  let low = 0x01000193;
  for (let i = 0; i < path.length; i += 1) {
    const code = path.charCodeAt(i);
    high = Math.imul(high ^ code, 0x01000193) | 0;
    low = Math.imul(low ^ code, 0x85ebca6b) | 0;
  }
  return [high, low];
}

async function writeDocumentInTx(
  tx: TenantTx,
  path: string,
  parsed: ReturnType<typeof parsePath>,
  payload: Record<string, unknown>,
): Promise<void> {
  const organizationId = extractOrganizationId(
    parsed.collectionRoot,
    parsed.segments,
    payload,
  );

  const crmEntity = crmEntityFromCollection(parsed.collectionRoot);
  if (crmEntity && parsed.segments.length === 2) {
    await syncCrmEntityInTx(tx, crmEntity, parsed.segments[1]!, payload);
  }

  const now = new Date();
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
}

/**
 * Read/modify/write helpers bound to one Postgres transaction. Every path they
 * touch is advisory-locked for the life of the transaction, so a read followed
 * by a dependent write cannot interleave with another writer.
 */
export type DocumentTxHandle = {
  read(path: string): Promise<StoredDoc | null>;
  write(path: string, data: Record<string, unknown>, merge: boolean): Promise<void>;
  update(path: string, patch: Record<string, unknown>): Promise<void>;
  remove(path: string): Promise<void>;
};

/**
 * Run document reads and writes as one atomic, serialized unit.
 *
 * Backs the Firestore shim's `runTransaction` / `batch`, whose callers rely on
 * check-then-act invariants (claim a chunk, reserve an identity, bump a counter
 * under a ceiling). Nothing commits unless `fn` resolves.
 */
export async function runDocumentTransaction<T>(
  fn: (dtx: DocumentTxHandle) => Promise<T>,
): Promise<T> {
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is not configured");
  }
  return withRlsBypass(async (tx) => {
    const locked = new Set<string>();
    const lockOnce = async (path: string): Promise<void> => {
      if (locked.has(path)) return;
      locked.add(path);
      await lockDocumentPath(tx, path);
    };

    return fn({
      async read(path) {
        await lockOnce(path);
        return readDocumentInTx(tx, path, parsePath(path));
      },
      async write(path, data, merge) {
        const parsed = parsePath(path);
        const serialized = serializePayloadValue(
          resolveWriteData(data),
        ) as Record<string, unknown>;
        await lockOnce(path);
        if (!merge) {
          await writeDocumentInTx(tx, path, parsed, serialized);
          return;
        }
        const existing = await readDocumentInTx(tx, path, parsed);
        await writeDocumentInTx(
          tx,
          path,
          parsed,
          existing ? { ...existing.payload, ...serialized } : serialized,
        );
      },
      async update(path, patch) {
        const parsed = parsePath(path);
        await lockOnce(path);
        const existing = await readDocumentInTx(tx, path, parsed);
        // Cutover-safe: clients historically called Firestore update() after local
        // creates. Upsert so missing pg_documents rows do not 500 the live UI.
        const merged = applyFieldValues(existing?.payload ?? {}, patch);
        await writeDocumentInTx(
          tx,
          path,
          parsed,
          serializePayloadValue(merged) as Record<string, unknown>,
        );
      },
      async remove(path) {
        const parsed = parsePath(path);
        await lockOnce(path);
        const crmEntity = crmEntityFromCollection(parsed.collectionRoot);
        if (crmEntity && parsed.segments.length === 2) {
          await syncCrmEntityInTx(tx, crmEntity, parsed.segments[1]!, {}, true);
        }
        await tx.pgDocument.deleteMany({ where: { path } });
      },
    });
  });
}

export async function setDocument(
  path: string,
  data: Record<string, unknown>,
  merge: boolean,
): Promise<void> {
  await runDocumentTransaction((dtx) => dtx.write(path, data, merge));
}

export async function updateDocument(
  path: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await runDocumentTransaction((dtx) => dtx.update(path, patch));
}

export async function deleteDocument(path: string): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await runDocumentTransaction((dtx) => dtx.remove(path));
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

function collectionRootFromCrmEntity(entity: CrmEntity): string {
  switch (entity) {
    case "account":
      return "accounts";
    case "contact":
      return "contacts";
    case "lead":
      return "leads";
    case "deal":
      return "deals";
  }
}

function crmRowToStoredDoc(
  entity: CrmEntity,
  row: {
    id: string;
    organizationId: string;
    payload: unknown;
    createdAt: Date;
    updatedAt: Date;
    contactId?: string;
    ownerId?: string;
    email?: string | null;
    accountId?: string;
  },
): StoredDoc {
  const collectionRoot = collectionRootFromCrmEntity(entity);
  const base = deserializePayload({
    ...(row.payload as Record<string, unknown>),
    organizationId: row.organizationId,
    id: row.id,
  });
  if (entity === "lead") {
    if (row.contactId) base.contactId = row.contactId;
    if (row.ownerId) base.ownerId = row.ownerId;
  } else if (entity === "contact") {
    if (row.email != null) base.email = row.email;
    if (row.ownerId) base.ownerId = row.ownerId;
    if (row.accountId) base.accountId = row.accountId;
  } else if (entity === "account" || entity === "deal") {
    if (row.ownerId) base.ownerId = row.ownerId;
  }
  return {
    path: `${collectionRoot}/${row.id}`,
    organizationId: row.organizationId,
    collectionRoot,
    payload: base,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Query CRM sole-writer tables (not leftover pg_documents copies).
 * Without this, `.collection("leads").where(...)` only sees ~few hundred
 * migrated stubs and misses the live Postgres CRM rows.
 */
async function queryCrmEntityDocuments(
  entity: CrmEntity,
  spec: QuerySpec,
): Promise<StoredDoc[]> {
  const organizationId = organizationIdFromSpec(spec);
  if (!organizationId) return [];

  const filters = spec.filters.filter((f) => f.field !== "organizationId");
  const contactEmailIn = filters.find(
    (f) => f.field === "contactEmail" && f.op === "in" && Array.isArray(f.value),
  );
  const contactIdEq = filters.find((f) => f.field === "contactId" && f.op === "==");
  const emailIn = filters.find(
    (f) => f.field === "email" && f.op === "in" && Array.isArray(f.value),
  );
  const personalEmailIn = filters.find(
    (f) => f.field === "personalEmail" && f.op === "in" && Array.isArray(f.value),
  );

  const rows = await withOrganizationScope(organizationId, async (tx) => {
    switch (entity) {
      case "lead": {
        const where: Prisma.LeadWhereInput = { organizationId };
        if (contactIdEq) {
          where.contactId = String(contactIdEq.value);
        } else if (contactEmailIn) {
          const emails = (contactEmailIn.value as unknown[])
            .map((v) => String(v).trim().toLowerCase())
            .filter((e) => e.includes("@"));
          if (emails.length === 0) return [];
          where.OR = emails.map((email) => ({
            payload: { path: ["contactEmail"], equals: email },
          }));
        }
        return tx.lead.findMany({
          where,
          take: spec.limit ?? undefined,
        });
      }
      case "contact": {
        const where: Prisma.ContactWhereInput = { organizationId };
        if (emailIn || personalEmailIn) {
          const or: Prisma.ContactWhereInput[] = [];
          if (emailIn) {
            const emails = (emailIn.value as unknown[])
              .map((v) => String(v).trim().toLowerCase())
              .filter(Boolean);
            if (emails.length) {
              or.push({ email: { in: emails, mode: "insensitive" } });
            }
          }
          if (personalEmailIn) {
            const emails = (personalEmailIn.value as unknown[])
              .map((v) => String(v).trim().toLowerCase())
              .filter(Boolean);
            for (const email of emails) {
              or.push({ payload: { path: ["personalEmail"], equals: email } });
            }
          }
          if (or.length === 0) return [];
          where.OR = or;
        }
        return tx.contact.findMany({
          where,
          take: spec.limit ?? undefined,
        });
      }
      case "account":
        return tx.account.findMany({
          where: { organizationId },
          take: spec.limit ?? undefined,
        });
      case "deal":
        return tx.deal.findMany({
          where: { organizationId },
          take: spec.limit ?? undefined,
        });
    }
  });

  let docs = rows.map((row) => crmRowToStoredDoc(entity, row));

  const pushedToSql = new Set<string>();
  if (entity === "lead") {
    if (contactIdEq) pushedToSql.add("contactId");
    if (contactEmailIn) pushedToSql.add("contactEmail");
  } else if (entity === "contact") {
    if (emailIn) pushedToSql.add("email");
    if (personalEmailIn) pushedToSql.add("personalEmail");
  }

  for (const filter of filters) {
    if (pushedToSql.has(filter.field)) continue;
    docs = docs.filter((d) => matchesFilter(d.payload, filter));
  }

  if (spec.orderBy) {
    const { field, direction } = spec.orderBy;
    docs.sort((a, b) => {
      const av = a.payload[field];
      const bv = b.payload[field];
      const aMs = coerceInstantMs(av);
      const bMs = coerceInstantMs(bv);
      let cmp = 0;
      if (aMs != null && bMs != null) {
        cmp = aMs - bMs;
      } else if (av instanceof Date && bv instanceof Date) {
        cmp = av.getTime() - bv.getTime();
      } else {
        cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      }
      return direction === "desc" ? -cmp : cmp;
    });
  }

  if (spec.limit != null) {
    docs = docs.slice(0, spec.limit);
  }

  return docs;
}

export async function queryDocuments(spec: QuerySpec): Promise<StoredDoc[]> {
  if (!isDatabaseConfigured()) return [];

  const organizationId = organizationIdFromSpec(spec);

  const crmEntity =
    !spec.collectionGroup && spec.collectionRoot
      ? crmEntityFromCollection(spec.collectionRoot)
      : null;
  if (crmEntity) {
    return queryCrmEntityDocuments(crmEntity, spec);
  }

  const loadRows = async (tx: TenantTx) => {
    if (spec.collectionGroup) {
      // Platform / cross-path scans still need bypass; callers must filter.
      return tx.pgDocument.findMany(
        organizationId
          ? {
              where: {
                OR: [
                  { organizationId },
                  {
                    AND: [
                      { organizationId: null },
                      {
                        payload: {
                          path: ["organizationId"],
                          equals: organizationId,
                        },
                      },
                    ],
                  },
                ],
              },
            }
          : undefined,
      );
    }

    const where: Prisma.PgDocumentWhereInput = {
      collectionRoot: spec.collectionRoot!,
      ...(spec.pathPrefix ? { path: { startsWith: spec.pathPrefix } } : {}),
    };

    if (organizationId) {
      where.OR = [
        { organizationId },
        {
          AND: [
            { organizationId: null },
            {
              payload: {
                path: ["organizationId"],
                equals: organizationId,
              },
            },
          ],
        },
      ];
    }

    return tx.pgDocument.findMany({ where });
  };

  const rows = organizationId
    ? await withOrganizationScope(organizationId, loadRows)
    : await withRlsBypass(loadRows);

  let docs = rows.map((row) => ({
    path: row.path,
    organizationId: row.organizationId,
    collectionRoot: row.collectionRoot,
    payload: deserializePayload(row.payload as Record<string, unknown>),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  if (organizationId) {
    // Defense in depth: RLS allows null organization_id rows for every tenant.
    docs = docs.filter((d) => documentMatchesOrganization(d, organizationId));
  }

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
    if (filter.field === "organizationId" && organizationId) {
      // Already applied via SQL + documentMatchesOrganization.
      continue;
    }
    docs = docs.filter((d) => {
      if (filter.field === "organizationId") {
        return matchesFilter(
          {
            organizationId: d.organizationId ?? d.payload.organizationId,
          },
          filter,
        );
      }
      return matchesFilter(d.payload, filter);
    });
  }

  if (spec.orderBy) {
    const { field, direction } = spec.orderBy;
    docs.sort((a, b) => {
      const av = a.payload[field];
      const bv = b.payload[field];
      const aMs = coerceInstantMs(av);
      const bMs = coerceInstantMs(bv);
      let cmp = 0;
      if (aMs != null && bMs != null) {
        cmp = aMs - bMs;
      } else if (av instanceof Date && bv instanceof Date) {
        cmp = av.getTime() - bv.getTime();
      } else {
        cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      }
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
