/** firebase/firestore client shim — polls workspace API instead of onSnapshot. */

import { Timestamp } from "@/lib/db/document-shim/timestamp";

export { Timestamp };

export type DocumentData = Record<string, unknown>;
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

async function fetchWorkspaceCollection(
  collectionPath: string,
): Promise<{ id: string; data: DocumentData }[]> {
  const res = await fetch(
    `/api/org/workspace-documents?collection=${encodeURIComponent(collectionPath)}`,
    { credentials: "same-origin", cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`workspace-documents ${res.status}`);
  }
  const json = (await res.json()) as { docs?: { id: string; data: DocumentData }[] };
  return Array.isArray(json.docs) ? json.docs : [];
}

export async function getDocs(
  q: ClientQuery | ClientCollectionReference,
): Promise<QuerySnapshot> {
  const path = q instanceof ClientQuery ? q.col.path : q.path;
  const rows = await fetchWorkspaceCollection(path);
  const docs = rows.map((d) => ({
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
  const rows = await fetchWorkspaceCollection(collectionPath);
  const found = rows.find((d) => d.id === ref.id);
  return {
    id: ref.id,
    exists: () => Boolean(found),
    data: () => found?.data ?? {},
  };
}

const POLL_MS = 60_000;
const POLL_ERROR_MS = 120_000;

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
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;

  async function poll() {
    if (cancelled || inFlight) return;
    inFlight = true;
    let nextDelay = POLL_MS;
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
      const rows = await fetchWorkspaceCollection(path);
      if (cancelled) return;
      const snap: QuerySnapshot = {
        docs: rows.map((d) => ({
          id: d.id,
          exists: () => true,
          data: () => d.data,
        })),
        empty: rows.length === 0,
        forEach(fn) {
          this.docs.forEach(fn);
        },
      };
      onNext(snap);
    } catch (err) {
      nextDelay = POLL_ERROR_MS;
      if (!cancelled) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      inFlight = false;
      if (!cancelled) {
        timer = setTimeout(() => {
          void poll();
        }, nextDelay);
      }
    }
  }

  void poll();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

export function getFirestore(): ClientFirestore {
  return new ClientFirestore();
}

export function documentTimestampToIso(value: unknown): string | undefined {
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
  const res = await fetch("/api/org/workspace-documents", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: ref.path }),
  });
  if (!res.ok) {
    throw new Error(`workspace-documents DELETE failed (${res.status})`);
  }
}

/**
 * Encode FieldValue symbols for /api/org/workspace-documents.
 * JSON.stringify drops Symbols, which previously made pause/unpause/schedule
 * patches silently omit deleteField / serverTimestamp.
 */
function encodeClientFieldValues(data: DocumentData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "symbol") {
      if (value.description === "FIELD_DELETE") {
        out[key] = { __fv: "delete" };
      } else if (value.description === "SERVER_TIMESTAMP") {
        out[key] = { __fv: "serverTimestamp" };
      }
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      if ("__increment" in (value as object) || "__arrayUnion" in (value as object) || "__arrayRemove" in (value as object)) {
        out[key] = value;
        continue;
      }
      out[key] = encodeClientFieldValues(value as DocumentData);
      continue;
    }
    out[key] = value;
  }
  return out;
}

export async function updateDoc(
  ref: DocumentReference,
  data: DocumentData,
): Promise<void> {
  const res = await fetch("/api/org/workspace-documents", {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: ref.path, patch: encodeClientFieldValues(data) }),
  });
  if (!res.ok) {
    throw new Error(`workspace-documents PATCH failed (${res.status})`);
  }
}

export async function setDoc(
  ref: DocumentReference,
  data: DocumentData,
  options?: { merge?: boolean },
): Promise<void> {
  const res = await fetch("/api/org/workspace-documents", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: ref.path,
      data: encodeClientFieldValues(data),
      merge: options?.merge,
    }),
  });
  if (!res.ok) {
    throw new Error(`workspace-documents PUT failed (${res.status})`);
  }
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
