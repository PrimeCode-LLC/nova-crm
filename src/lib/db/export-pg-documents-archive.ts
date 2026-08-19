/**
 * P6.3 — Export Firestore CRM (and optional full tenant) docs to a local JSONL archive.
 *
 * Default scope: organizations, members, accounts, contacts, leads, deals,
 * orgDashboardSummaries. Use `--full` for all TENANT_COLLECTIONS + users.
 *
 * Timestamps → ISO strings. Output never committed (see `archives/` in .gitignore).
 */

import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { finished } from "node:stream/promises";
import type { DocumentData, QueryDocumentSnapshot } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import {
  COLLECTIONS,
  ORG_SUBCOLLECTIONS,
  TENANT_COLLECTIONS,
} from "@/lib/firestore/collections";

export const CRM_ARCHIVE_COLLECTIONS = [
  COLLECTIONS.organizations,
  COLLECTIONS.accounts,
  COLLECTIONS.contacts,
  COLLECTIONS.leads,
  COLLECTIONS.deals,
  COLLECTIONS.orgDashboardSummaries,
] as const;

export type FirestoreCrmArchiveOptions = {
  /** Absolute or cwd-relative output directory. Created if missing. */
  outDir: string;
  /** When set, only docs with this organizationId (and that org + its members). */
  organizationId?: string;
  /** Include all TENANT_COLLECTIONS + users (still insurance; larger). */
  full?: boolean;
  dryRun?: boolean;
  /** Max docs per collection (smoke). */
  limitPerCollection?: number;
  pageSize?: number;
  onProgress?: (message: string) => void;
};

export type CollectionExportStats = {
  collection: string;
  docs: number;
  bytes: number;
  file: string | null;
};

export type FirestoreCrmArchiveResult = {
  outDir: string;
  dryRun: boolean;
  full: boolean;
  organizationId: string | null;
  startedAt: string;
  finishedAt: string;
  collections: CollectionExportStats[];
  totalDocs: number;
  errors: string[];
};

const DEFAULT_PAGE_SIZE = 200;

/** Recursively convert Firestore Timestamp / Date / GeoPoint-ish values for JSON. */
export function serializeFirestoreValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.toDate === "function") {
      try {
        const d = (v.toDate as () => Date)();
        if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
      } catch {
        /* fall through */
      }
    }
    if (typeof v._seconds === "number") {
      const ms = v._seconds * 1000 + Math.floor((Number(v._nanoseconds) || 0) / 1e6);
      return new Date(ms).toISOString();
    }
    if (Array.isArray(value)) {
      return value.map(serializeFirestoreValue);
    }
    const out: Record<string, unknown> = {};
    for (const [k, child] of Object.entries(v)) {
      out[k] = serializeFirestoreValue(child);
    }
    return out;
  }
  return String(value);
}

function collectionFileName(collectionId: string): string {
  return `${collectionId.replace(/[/\\]/g, "__")}.jsonl`;
}

async function* iterateCollectionDocs(opts: {
  collectionId: string;
  organizationId?: string;
  pageSize: number;
  limit?: number;
}): AsyncGenerator<QueryDocumentSnapshot, void, undefined> {
  const db = getAdminDb();
  if (!db) return;

  let yielded = 0;
  let last: QueryDocumentSnapshot | undefined;

  for (;;) {
    let q = db.collection(opts.collectionId).orderBy("__name__").limit(opts.pageSize);
    if (opts.organizationId) {
      q = db
        .collection(opts.collectionId)
        .where("organizationId", "==", opts.organizationId)
        .orderBy("__name__")
        .limit(opts.pageSize);
    }
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      yield doc;
      yielded += 1;
      if (opts.limit != null && yielded >= opts.limit) return;
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < opts.pageSize) break;
  }
}

async function exportTopLevelCollection(
  collectionId: string,
  opts: FirestoreCrmArchiveOptions,
): Promise<CollectionExportStats> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const file = path.join(opts.outDir, collectionFileName(collectionId));
  let docs = 0;
  let bytes = 0;
  const db = getAdminDb();
  if (!db) {
    return { collection: collectionId, docs: 0, bytes: 0, file: null };
  }

  const writeDoc = async (
    stream: ReturnType<typeof createWriteStream> | null,
    id: string,
    docPath: string,
    data: DocumentData,
  ) => {
    const line =
      JSON.stringify({
        id,
        path: docPath,
        data: serializeFirestoreValue(data),
      }) + "\n";
    docs += 1;
    bytes += Buffer.byteLength(line);
    if (stream) {
      if (!stream.write(line)) {
        await new Promise<void>((resolve) => stream.once("drain", resolve));
      }
    }
  };

  if (collectionId === COLLECTIONS.organizations && opts.organizationId) {
    const snap = await db.collection(collectionId).doc(opts.organizationId).get();
    if (!snap.exists) {
      return { collection: collectionId, docs: 0, bytes: 0, file: opts.dryRun ? null : file };
    }
    if (opts.dryRun) {
      return { collection: collectionId, docs: 1, bytes: 0, file: null };
    }
    mkdirSync(opts.outDir, { recursive: true });
    const stream = createWriteStream(file, { encoding: "utf8" });
    await writeDoc(stream, snap.id, snap.ref.path, snap.data() as DocumentData);
    stream.end();
    await finished(stream);
    return { collection: collectionId, docs, bytes, file };
  }

  if (opts.dryRun) {
    for await (const _ of iterateCollectionDocs({
      collectionId,
      organizationId:
        collectionId === COLLECTIONS.organizations ? undefined : opts.organizationId,
      pageSize,
      limit: opts.limitPerCollection,
    })) {
      docs += 1;
    }
    return { collection: collectionId, docs, bytes: 0, file: null };
  }

  mkdirSync(opts.outDir, { recursive: true });
  const stream = createWriteStream(file, { encoding: "utf8" });
  for await (const doc of iterateCollectionDocs({
    collectionId,
    organizationId:
      collectionId === COLLECTIONS.organizations ? undefined : opts.organizationId,
    pageSize,
    limit: opts.limitPerCollection,
  })) {
    await writeDoc(stream, doc.id, doc.ref.path, doc.data() as DocumentData);
  }
  stream.end();
  await finished(stream);
  return { collection: collectionId, docs, bytes, file };
}

async function exportOrgMembers(
  opts: FirestoreCrmArchiveOptions,
): Promise<CollectionExportStats> {
  const collectionLabel = `organizations/*/${ORG_SUBCOLLECTIONS.members}`;
  const db = getAdminDb();
  if (!db) {
    return { collection: collectionLabel, docs: 0, bytes: 0, file: null };
  }

  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const file = path.join(opts.outDir, "organization_members.jsonl");
  let docs = 0;
  let bytes = 0;

  const orgIds: string[] = [];
  if (opts.organizationId) {
    orgIds.push(opts.organizationId);
  } else {
    for await (const orgDoc of iterateCollectionDocs({
      collectionId: COLLECTIONS.organizations,
      pageSize,
      limit: opts.limitPerCollection,
    })) {
      orgIds.push(orgDoc.id);
    }
  }

  if (opts.dryRun) {
    for (const orgId of orgIds) {
      let last: QueryDocumentSnapshot | undefined;
      let orgMemberCount = 0;
      for (;;) {
        let q = db
          .collection(COLLECTIONS.organizations)
          .doc(orgId)
          .collection(ORG_SUBCOLLECTIONS.members)
          .orderBy("__name__")
          .limit(pageSize);
        if (last) q = q.startAfter(last);
        const snap = await q.get();
        if (snap.empty) break;
        orgMemberCount += snap.size;
        last = snap.docs[snap.docs.length - 1];
        if (snap.size < pageSize) break;
      }
      docs += orgMemberCount;
      if (opts.limitPerCollection != null && docs >= opts.limitPerCollection) {
        docs = Math.min(docs, opts.limitPerCollection);
        break;
      }
    }
    return { collection: collectionLabel, docs, bytes: 0, file: null };
  }

  mkdirSync(opts.outDir, { recursive: true });
  const stream = createWriteStream(file, { encoding: "utf8" });

  outer: for (const orgId of orgIds) {
    let last: QueryDocumentSnapshot | undefined;
    for (;;) {
      let q = db
        .collection(COLLECTIONS.organizations)
        .doc(orgId)
        .collection(ORG_SUBCOLLECTIONS.members)
        .orderBy("__name__")
        .limit(pageSize);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      for (const doc of snap.docs) {
        const line =
          JSON.stringify({
            id: doc.id,
            organizationId: orgId,
            path: doc.ref.path,
            data: serializeFirestoreValue(doc.data() as DocumentData),
          }) + "\n";
        if (!stream.write(line)) {
          await new Promise<void>((resolve) => stream.once("drain", resolve));
        }
        docs += 1;
        bytes += Buffer.byteLength(line);
        if (opts.limitPerCollection != null && docs >= opts.limitPerCollection) {
          break outer;
        }
      }
      last = snap.docs[snap.docs.length - 1];
      if (snap.size < pageSize) break;
    }
  }

  stream.end();
  await finished(stream);
  return { collection: collectionLabel, docs, bytes, file };
}

export async function runFirestoreCrmArchive(
  options: FirestoreCrmArchiveOptions,
): Promise<FirestoreCrmArchiveResult> {
  const startedAt = new Date().toISOString();
  const log = options.onProgress ?? (() => undefined);
  const errors: string[] = [];
  const collections: CollectionExportStats[] = [];

  if (!getAdminDb()) {
    errors.push("Firebase Admin is not configured (FIREBASE_ADMIN_* env)");
    return {
      outDir: options.outDir,
      dryRun: Boolean(options.dryRun),
      full: Boolean(options.full),
      organizationId: options.organizationId ?? null,
      startedAt,
      finishedAt: new Date().toISOString(),
      collections,
      totalDocs: 0,
      errors,
    };
  }

  mkdirSync(options.outDir, { recursive: true });

  const topLevel: string[] = options.full
    ? [
        COLLECTIONS.organizations,
        COLLECTIONS.users,
        COLLECTIONS.platformAdmins,
        ...TENANT_COLLECTIONS,
      ]
    : [...CRM_ARCHIVE_COLLECTIONS];

  // Dedupe while preserving order
  const seen = new Set<string>();
  const uniqueTop = topLevel.filter((c) => {
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });

  for (const collectionId of uniqueTop) {
    log(`Exporting ${collectionId}…`);
    try {
      const stats = await exportTopLevelCollection(collectionId, options);
      collections.push(stats);
      log(`  → ${stats.docs} docs`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${collectionId}: ${msg}`);
      log(`  ! ${msg}`);
    }
  }

  log("Exporting organization members…");
  try {
    const memberStats = await exportOrgMembers(options);
    collections.push(memberStats);
    log(`  → ${memberStats.docs} docs`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`members: ${msg}`);
    log(`  ! ${msg}`);
  }

  const finishedAt = new Date().toISOString();
  const totalDocs = collections.reduce((sum, c) => sum + c.docs, 0);
  const manifest: FirestoreCrmArchiveResult = {
    outDir: options.outDir,
    dryRun: Boolean(options.dryRun),
    full: Boolean(options.full),
    organizationId: options.organizationId ?? null,
    startedAt,
    finishedAt,
    collections,
    totalDocs,
    errors,
  };

  if (!options.dryRun) {
    writeFileSync(
      path.join(options.outDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
  }

  return manifest;
}
