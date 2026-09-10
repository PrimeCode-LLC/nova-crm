/**
 * Postgres-backed Firestore Admin API shim (P7).
 */

import {
  applyFieldValues,
  FIELD_DELETE,
  SERVER_TIMESTAMP,
  type ArrayRemoveSentinel,
  type ArrayUnionSentinel,
  type IncrementSentinel,
} from "@/lib/db/document-shim/field-values";
import {
  deleteDocument,
  getDocument,
  queryDocuments,
  setDocument,
  updateDocument,
  type QueryFilter,
  type QuerySpec,
  type StoredDoc,
} from "@/lib/db/document-shim/store";
import { buildPath } from "@/lib/db/document-shim/path";
import { Timestamp } from "@/lib/db/document-shim/timestamp";

export { Timestamp };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DocumentData = Record<string, any>;
export type DocumentReference = PgDocumentReference;
export type CollectionReference = PgCollectionReference;
export type Transaction = PgTransaction;
export type Firestore = PgFirestore;
export type DocumentSnapshot = PgDocumentSnapshot;

export const FieldValue = {
  serverTimestamp: () => SERVER_TIMESTAMP,
  delete: () => FIELD_DELETE,
  increment: (n: number): IncrementSentinel => ({ __increment: n }),
  arrayUnion: (...elements: unknown[]): ArrayUnionSentinel => ({
    __arrayUnion: elements,
  }),
  arrayRemove: (...elements: unknown[]): ArrayRemoveSentinel => ({
    __arrayRemove: elements,
  }),
  vector: (values: number[]) => ({ __vector: values }),
};

export class FieldPath {
  readonly segments: string[];
  constructor(...segments: string[]) {
    this.segments = segments;
  }
  static documentId(): FieldPath {
    return new FieldPath("__name__");
  }
}

export class PgDocumentSnapshot {
  constructor(
    readonly ref: PgDocumentReference,
    private readonly _doc: StoredDoc | null,
  ) {}

  get id(): string {
    return this.ref.id;
  }

  get exists(): boolean {
    return this._doc != null;
  }

  data(): DocumentData {
    if (!this._doc) return {};
    return { ...this._doc.payload };
  }

  get createTime(): Timestamp | undefined {
    return this._doc ? Timestamp.fromDate(this._doc.createdAt) : undefined;
  }

  get updateTime(): Timestamp | undefined {
    return this._doc ? Timestamp.fromDate(this._doc.updatedAt) : undefined;
  }
}

export class PgQuerySnapshot {
  constructor(readonly docs: PgDocumentSnapshot[]) {}

  get empty(): boolean {
    return this.docs.length === 0;
  }

  get size(): number {
    return this.docs.length;
  }

  forEach(fn: (doc: PgDocumentSnapshot) => void): void {
    this.docs.forEach(fn);
  }
}

export class PgDocumentReference {
  readonly firestore: PgFirestore;

  constructor(
    firestore: PgFirestore,
    readonly path: string,
  ) {
    this.firestore = firestore;
  }

  get id(): string {
    const parts = this.path.split("/");
    return parts[parts.length - 1] ?? "";
  }

  get parent(): PgCollectionReference {
    const parts = this.path.split("/");
    parts.pop();
    return new PgCollectionReference(this.firestore, parts);
  }

  collection(name: string): PgCollectionReference {
    return new PgCollectionReference(this.firestore, [...this.path.split("/"), name]);
  }

  async get(): Promise<PgDocumentSnapshot> {
    const doc = await getDocument(this.path);
    return new PgDocumentSnapshot(this, doc);
  }

  async set(
    data: DocumentData,
    options?: { merge?: boolean; fieldMask?: string[] },
  ): Promise<void> {
    let payload = data;
    if (options?.fieldMask?.length) {
      payload = Object.fromEntries(
        options.fieldMask.map((k) => [k, data[k]]).filter(([, v]) => v !== undefined),
      );
    }
    await setDocument(this.path, payload, options?.merge ?? false);
  }

  async create(data: DocumentData): Promise<void> {
    const existing = await getDocument(this.path);
    if (existing) {
      throw new Error(`Document ${this.path} already exists`);
    }
    await this.set(data);
  }

  async update(data: DocumentData): Promise<void> {
    await updateDocument(this.path, data);
  }

  async delete(): Promise<void> {
    await deleteDocument(this.path);
  }
}

export class PgCollectionReference {
  readonly firestore: PgFirestore;
  readonly path: string;
  readonly id: string;

  constructor(firestore: PgFirestore, segments: string[]) {
    this.firestore = firestore;
    this.path = buildPath(segments.filter(Boolean));
    this.id = segments.filter(Boolean).pop() ?? "";
  }

  get parent(): PgDocumentReference | null {
    const parts = this.path.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return new PgDocumentReference(
      this.firestore,
      parts.slice(0, -1).join("/"),
    );
  }

  doc(id?: string): PgDocumentReference {
    const docId = id ?? crypto.randomUUID();
    return new PgDocumentReference(this.firestore, `${this.path}/${docId}`);
  }

  async add(data: DocumentData): Promise<PgDocumentReference> {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }

  where(field: string, op: QueryFilter["op"], value: unknown): PgQuery {
    return new PgQuery(this.firestore, this.path, [{ field, op, value }]);
  }

  orderBy(field: string | FieldPath, direction: "asc" | "desc" = "asc"): PgQuery {
    const fieldName =
      field instanceof FieldPath ? field.segments.join(".") : field;
    return new PgQuery(this.firestore, this.path, [], { field: fieldName, direction });
  }

  limit(n: number): PgQuery {
    return new PgQuery(this.firestore, this.path, [], undefined, n);
  }

  select(..._fields: string[]): PgQuery {
    return new PgQuery(this.firestore, this.path, []);
  }

  count(): PgAggregateQuery {
    return new PgQuery(this.firestore, this.path, []).count();
  }

  async get(): Promise<PgQuerySnapshot> {
    return new PgQuery(this.firestore, this.path, []).get();
  }
}

export class PgCollectionGroupReference {
  constructor(
    readonly firestore: PgFirestore,
    readonly collectionId: string,
  ) {}

  where(field: string, op: QueryFilter["op"], value: unknown): PgQuery {
    return new PgQuery(this.firestore, "", [{ field, op, value }], undefined, undefined, undefined, this.collectionId);
  }

  orderBy(field: string, direction: "asc" | "desc" = "asc"): PgQuery {
    return new PgQuery(this.firestore, "", [], { field, direction }, undefined, undefined, this.collectionId);
  }

  limit(n: number): PgQuery {
    return new PgQuery(this.firestore, "", [], undefined, n, undefined, this.collectionId);
  }

  select(..._fields: string[]): PgQuery {
    return new PgQuery(this.firestore, "", [], undefined, undefined, undefined, this.collectionId);
  }

  count(): PgAggregateQuery {
    return new PgQuery(this.firestore, "", [], undefined, undefined, undefined, this.collectionId).count();
  }

  async get(): Promise<PgQuerySnapshot> {
    return new PgQuery(this.firestore, "", [], undefined, undefined, undefined, this.collectionId).get();
  }
}

export class PgQuery {
  private readonly filters: QueryFilter[];
  private readonly orderBySpec?: { field: string; direction: "asc" | "desc" };
  private readonly limitN?: number;
  private readonly startAfterValues?: unknown[];
  private readonly collectionGroupId?: string;

  constructor(
    readonly firestore: PgFirestore,
    readonly collectionPath: string,
    filters: QueryFilter[] = [],
    orderBySpec?: { field: string; direction: "asc" | "desc" },
    limitN?: number,
    startAfterValues?: unknown[],
    collectionGroupId?: string,
  ) {
    this.filters = filters;
    this.orderBySpec = orderBySpec;
    this.limitN = limitN;
    this.startAfterValues = startAfterValues;
    this.collectionGroupId = collectionGroupId;
  }

  private next(
    patch: Partial<{
      filters: QueryFilter[];
      orderBySpec: { field: string; direction: "asc" | "desc" };
      limitN: number;
      startAfterValues: unknown[];
    }>,
  ): PgQuery {
    return new PgQuery(
      this.firestore,
      this.collectionPath,
      patch.filters ?? this.filters,
      patch.orderBySpec ?? this.orderBySpec,
      patch.limitN ?? this.limitN,
      patch.startAfterValues ?? this.startAfterValues,
      this.collectionGroupId,
    );
  }

  where(field: string, op: QueryFilter["op"], value: unknown): PgQuery {
    return this.next({ filters: [...this.filters, { field, op, value }] });
  }

  orderBy(field: string | FieldPath, direction: "asc" | "desc" = "asc"): PgQuery {
    const fieldName =
      field instanceof FieldPath ? field.segments.join(".") : field;
    return this.next({ orderBySpec: { field: fieldName, direction } });
  }

  limit(n: number): PgQuery {
    return this.next({ limitN: n });
  }

  /** Firestore pagination — returns same query (Postgres loads full filtered set). */
  offset(_n: number): PgQuery {
    return this;
  }

  select(..._fields: string[]): PgQuery {
    return this;
  }

  startAfter(...values: unknown[]): PgQuery {
    return this.next({ startAfterValues: values });
  }

  count(): PgAggregateQuery {
    return new PgAggregateQuery(this);
  }

  findNearest(_opts: {
    vectorField: string;
    queryVector: unknown;
    limit: number;
    distanceMeasure?: string;
    distanceResultField?: string;
  }): PgVectorQuery {
    return new PgVectorQuery(this);
  }

  async get(): Promise<PgQuerySnapshot> {
    const segments = this.collectionPath.split("/").filter(Boolean);
    const collectionRoot = this.collectionGroupId ? undefined : segments[0] ?? "";
    const spec: QuerySpec = {
      collectionRoot,
      collectionGroup: this.collectionGroupId,
      pathPrefix: this.collectionPath || undefined,
      filters: this.filters,
      orderBy: this.orderBySpec,
      limit: this.limitN,
      startAfter: this.startAfterValues,
    };
    const docs = await queryDocuments(spec);
    const snapshots = docs.map(
      (d) =>
        new PgDocumentSnapshot(
          new PgDocumentReference(this.firestore, d.path),
          d,
        ),
    );
    return new PgQuerySnapshot(snapshots);
  }
}

export class PgAggregateQuery {
  constructor(private readonly query: PgQuery) {}

  async get(): Promise<{ data: () => { count: number } }> {
    const snap = await this.query.get();
    const count = snap.size;
    return { data: () => ({ count }) };
  }
}

/** Vector KNN query — returns empty snapshot; RAG falls back to in-app cosine scan. */
export class PgVectorQuery {
  constructor(private readonly query: PgQuery) {}

  async get(): Promise<PgQuerySnapshot> {
    void this.query;
    return new PgQuerySnapshot([]);
  }
}

type BatchOp =
  | { type: "set"; ref: PgDocumentReference; data: DocumentData; merge?: boolean }
  | { type: "update"; ref: PgDocumentReference; data: DocumentData }
  | { type: "delete"; ref: PgDocumentReference };

export class PgWriteBatch {
  private ops: BatchOp[] = [];

  set(
    ref: PgDocumentReference,
    data: DocumentData,
    options?: { merge?: boolean },
  ): PgWriteBatch {
    this.ops.push({ type: "set", ref, data, merge: options?.merge });
    return this;
  }

  update(ref: PgDocumentReference, data: DocumentData): PgWriteBatch {
    this.ops.push({ type: "update", ref, data });
    return this;
  }

  create(ref: PgDocumentReference, data: DocumentData): PgWriteBatch {
    this.ops.push({ type: "set", ref, data, merge: false });
    return this;
  }

  delete(ref: PgDocumentReference): PgWriteBatch {
    this.ops.push({ type: "delete", ref });
    return this;
  }

  async commit(): Promise<void> {
    for (const op of this.ops) {
      switch (op.type) {
        case "set":
          await op.ref.set(op.data, { merge: op.merge });
          break;
        case "update":
          await op.ref.update(op.data);
          break;
        case "delete":
          await op.ref.delete();
          break;
      }
    }
  }
}

export class PgTransaction {
  private readonly pendingGets = new Map<string, StoredDoc | null>();

  constructor(private readonly firestore: PgFirestore) {}

  async get(ref: PgDocumentReference): Promise<PgDocumentSnapshot> {
    if (this.pendingGets.has(ref.path)) {
      const doc = this.pendingGets.get(ref.path) ?? null;
      return new PgDocumentSnapshot(ref, doc);
    }
    const doc = await getDocument(ref.path);
    this.pendingGets.set(ref.path, doc);
    return new PgDocumentSnapshot(ref, doc);
  }

  set(
    ref: PgDocumentReference,
    data: DocumentData,
    options?: { merge?: boolean },
  ): PgTransaction {
    const existing = this.pendingGets.get(ref.path);
    let payload: Record<string, unknown>;
    if (options?.merge && existing) {
      payload = { ...existing.payload, ...applyFieldValues({}, data) };
    } else {
      payload = applyFieldValues({}, data);
    }
    this.pendingGets.set(ref.path, {
      path: ref.path,
      organizationId: null,
      collectionRoot: ref.path.split("/")[0] ?? "",
      payload,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    });
    return this;
  }

  update(ref: PgDocumentReference, data: DocumentData): PgTransaction {
    const existing = this.pendingGets.get(ref.path);
    if (!existing) {
      throw new Error(`Transaction update: document ${ref.path} not found`);
    }
    const payload = applyFieldValues(existing.payload, data);
    this.pendingGets.set(ref.path, { ...existing, payload, updatedAt: new Date() });
    return this;
  }

  delete(ref: PgDocumentReference): PgTransaction {
    this.pendingGets.set(ref.path, null);
    return this;
  }

  create(ref: PgDocumentReference, data: DocumentData): PgTransaction {
    return this.set(ref, data, { merge: false });
  }

  async commit(): Promise<void> {
    for (const [path, doc] of this.pendingGets) {
      if (doc === null) {
        await deleteDocument(path);
      } else {
        await setDocument(path, doc.payload, false);
      }
    }
  }
}

export class PgFirestore {
  collection(path: string): PgCollectionReference {
    return new PgCollectionReference(this, path.split("/").filter(Boolean));
  }

  collectionGroup(collectionId: string): PgCollectionGroupReference {
    return new PgCollectionGroupReference(this, collectionId);
  }

  doc(path: string): PgDocumentReference {
    return new PgDocumentReference(this, path);
  }

  batch(): PgWriteBatch {
    return new PgWriteBatch();
  }

  async getAll(
    ...args: Array<PgDocumentReference | { fieldMask?: string[] }>
  ): Promise<PgDocumentSnapshot[]> {
    let fieldMask: string[] | undefined;
    let refs = args;
    const last = refs[refs.length - 1];
    if (
      last &&
      typeof last === "object" &&
      "fieldMask" in last &&
      !("path" in last)
    ) {
      fieldMask = (last as { fieldMask?: string[] }).fieldMask;
      refs = refs.slice(0, -1);
    }
    const snaps = await Promise.all(
      (refs as PgDocumentReference[]).map((ref) => ref.get()),
    );
    if (!fieldMask?.length) return snaps;
    return snaps.map((snap) => {
      if (!snap.exists) return snap;
      const data = snap.data();
      const masked = Object.fromEntries(
        fieldMask!.map((k) => [k, data[k]]).filter(([, v]) => v !== undefined),
      );
      const ref = snap.ref;
      return new PgDocumentSnapshot(ref, {
        path: ref.path,
        organizationId: null,
        collectionRoot: ref.path.split("/")[0] ?? "",
        payload: masked,
        createdAt: snap.createTime?.toDate() ?? new Date(),
        updatedAt: snap.updateTime?.toDate() ?? new Date(),
      });
    });
  }

  async runTransaction<T>(
    fn: (tx: PgTransaction) => Promise<T>,
  ): Promise<T> {
    const tx = new PgTransaction(this);
    const result = await fn(tx);
    await tx.commit();
    return result;
  }
}

let singleton: PgFirestore | null = null;

export function getPgFirestore(): PgFirestore {
  if (!singleton) singleton = new PgFirestore();
  return singleton;
}

export function getFirestore(): PgFirestore {
  return getPgFirestore();
}

export type QueryDocumentSnapshot<_T = DocumentData> = PgDocumentSnapshot;
export type Query<_T = DocumentData> = PgQuery;
export type QuerySnapshot = PgQuerySnapshot;
export type WriteBatch = PgWriteBatch;

export { applyFieldValues, SERVER_TIMESTAMP, FIELD_DELETE };
