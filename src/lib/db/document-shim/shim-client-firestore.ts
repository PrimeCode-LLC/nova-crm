/** firebase/firestore client shim — polls workspace API instead of onSnapshot. */

import { Timestamp } from "@/lib/db/pg-firestore/timestamp";

export { Timestamp };

export type DocumentData = Record<string, any>;
export type Unsubscribe = () => void;

export type QueryConstraint = {
  type: "where" | "orderBy" | "limit";
  field?: string;
  op?: string;
  value?: unknown;
  direction?: "asc" | "desc";
  count?: number;
};

export function where(field: string, op: string, value: unknown): QueryConstraint {
  return { type: "where", field, op, value };
}

export function orderBy(field: string, direction: "asc" | "desc" = "asc"): QueryConstraint {
  return { type: "orderBy", field, direction };
}

export function limit(count: number): QueryConstraint {
  return { type: "limit", count };
}

export function and(...constraints: QueryConstraint[]): QueryConstraint {
  return { type: "where", field: "__and__", op: "and", value: constraints };
}

export function or(...constraints: QueryConstraint[]): QueryConstraint {
  return { type: "where", field: "__or__", op: "or", value: constraints };
}

export function query(
  col: ClientCollectionReference,
  ...constraints: QueryConstraint[]
): ClientQuery {
  return new ClientQuery(col, constraints);
}

export function collection(_db: ClientFirestore, path: string): ClientCollectionReference {
  return new ClientCollectionReference(path);
}

export class ClientFirestore {
  // placeholder
}

export class ClientCollectionReference {
  constructor(readonly path: string) {}
}

export class ClientQuery {
  constructor(
    readonly col: ClientCollectionReference,
    readonly constraints: QueryConstraint[],
  ) {}
}

export type DocumentSnapshot = {
  id: string;
  exists: () => boolean;
  data: () => DocumentData;
};

export type QuerySnapshot = {
  docs: DocumentSnapshot[];
  empty: boolean;
  forEach: (fn: (doc: DocumentSnapshot) => void) => void;
};

export type Query = ClientQuery;

export type DocumentReference = { id: string; path: string };

export function doc(_db: ClientFirestore, path: string, ...pathSegments: string[]): DocumentReference {
  const full = [path, ...pathSegments].filter(Boolean).join("/");
  return { id: full.split("/").pop() ?? full, path: full };
}

function isDocumentReference(target: unknown): target is DocumentReference {
  return (
    typeof target === "object" &&
    target !== null &&
    "path" in target &&
    "id" in target &&
    !(target instanceof ClientCollectionReference) &&
    !(target instanceof ClientQuery)
  );
}

export async function getDocs(
  q: ClientQuery | ClientCollectionReference,
): Promise<QuerySnapshot> {
  const path = q instanceof ClientQuery ? q.col.path : q.path;
  const res = await fetch(`/api/org/workspace-documents?collection=${encodeURIComponent(path)}`);
  const json = (await res.json()) as { docs: { id: string; data: DocumentData }[] };
  const docs = json.docs.map((d) => ({
    id: d.id,
    exists: () => true,
    data: () => d.data,
  }));
  return {
    docs,
    empty: docs.length === 0,
    forEach(fn) {
      docs.forEach(fn);
    },
  };
}

export async function getDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
  const collectionPath = ref.path.split("/").slice(0, -1).join("/");
  const res = await fetch(
    `/api/org/workspace-documents?collection=${encodeURIComponent(collectionPath)}`,
  );
  const json = (await res.json()) as { docs: { id: string; data: DocumentData }[] };
  const found = json.docs.find((d) => d.id === ref.id);
  return {
    id: ref.id,
    exists: () => Boolean(found),
    data: () => found?.data ?? {},
  };
}

const POLL_MS = 60_000;

export function onSnapshot(
  ref: DocumentReference,
  onNext: (snap: DocumentSnapshot) => void,
  onError?: (err: Error) => void,
): Unsubscribe;
export function onSnapshot(
  target: ClientCollectionReference | ClientQuery,
  onNext: (snap: QuerySnapshot) => void,
  onError?: (err: Error) => void,
): Unsubscribe;
export function onSnapshot(
  target: ClientCollectionReference | ClientQuery | DocumentReference,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onNext: (snap: any) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  let cancelled = false;

  async function poll() {
    try {
      if (isDocumentReference(target)) {
        const snap = await getDoc(target);
        if (cancelled) return;
        onNext(snap);
        return;
      }
      const path =
        target instanceof ClientQuery
          ? target.col.path
          : target.path;
      const res = await fetch(`/api/org/workspace-documents?collection=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error(`workspace-documents ${res.status}`);
      const json = (await res.json()) as { docs: { id: string; data: DocumentData }[] };
      if (cancelled) return;
      const snap: QuerySnapshot = {
        docs: json.docs.map((d) => ({
          id: d.id,
          exists: () => true,
          data: () => d.data,
        })),
        empty: json.docs.length === 0,
        forEach(fn) {
          this.docs.forEach(fn);
        },
      };
      onNext(snap);
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  void poll();
  const interval = setInterval(() => void poll(), POLL_MS);
  return () => {
    cancelled = true;
    clearInterval(interval);
  };
}

export function getFirestore(): ClientFirestore {
  return new ClientFirestore();
}

export function firestoreValueToIso(value: unknown): string | undefined {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return undefined;
}

export type Firestore = ClientFirestore;

export function serverTimestamp(): symbol {
  return Symbol("SERVER_TIMESTAMP");
}

export function deleteField(): symbol {
  return Symbol("FIELD_DELETE");
}

export function increment(n: number): { __increment: number } {
  return { __increment: n };
}

export async function deleteDoc(ref: DocumentReference): Promise<void> {
  await fetch("/api/org/workspace-documents", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: ref.path }),
  });
}

export async function updateDoc(
  ref: DocumentReference,
  data: DocumentData,
): Promise<void> {
  await fetch("/api/org/workspace-documents", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: ref.path, patch: data }),
  });
}

export async function setDoc(
  ref: DocumentReference,
  data: DocumentData,
  options?: { merge?: boolean },
): Promise<void> {
  await fetch("/api/org/workspace-documents", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: ref.path, data, merge: options?.merge }),
  });
}

export async function addDoc(
  col: ClientCollectionReference,
  data: DocumentData,
): Promise<DocumentReference> {
  const id = crypto.randomUUID();
  const path = `${col.path}/${id}`;
  await setDoc({ id, path }, data);
  return { id, path };
}

export function writeBatch(_db: ClientFirestore) {
  const ops: Array<() => Promise<void>> = [];
  return {
    set(ref: DocumentReference, data: DocumentData) {
      ops.push(() => setDoc(ref, data));
      return this;
    },
    update(ref: DocumentReference, data: DocumentData) {
      ops.push(() => updateDoc(ref, data));
      return this;
    },
    delete(ref: DocumentReference) {
      ops.push(() => deleteDoc(ref));
      return this;
    },
    async commit() {
      for (const op of ops) await op();
    },
  };
}
