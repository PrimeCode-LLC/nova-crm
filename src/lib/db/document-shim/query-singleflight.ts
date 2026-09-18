/**
 * Collapse duplicate concurrent `queryDocuments` reads for the same spec.
 * Very short in-process TTL (stampede guard within one poll tick) — not a
 * substitute for Redis dashboard caches.
 */

import type { QuerySpec, StoredDoc } from "@/lib/db/document-shim/store";
import { querySpecCacheKey } from "@/lib/db/document-shim/query-pushdown";

/** ~one event-loop / poll-tick window — keeps concurrent member slices sharing work. */
export const DOCUMENT_QUERY_SINGLEFLIGHT_TTL_MS = 250;

type CacheEntry = {
  expiresAt: number;
  docs: StoredDoc[];
};

const inflight = new Map<string, Promise<StoredDoc[]>>();
const cache = new Map<string, CacheEntry>();

function cloneDocs(docs: StoredDoc[]): StoredDoc[] {
  return docs.map((d) => ({
    path: d.path,
    organizationId: d.organizationId,
    collectionRoot: d.collectionRoot,
    payload: { ...d.payload },
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));
}

/** Drop cached / in-flight entries (optional; TTL already bounds staleness). */
export function invalidateDocumentQueryCache(collectionRoot?: string): void {
  if (!collectionRoot) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.includes(`"collectionRoot":"${collectionRoot}"`)) {
      cache.delete(key);
    }
  }
}

/**
 * Run `loader` once per identical spec while in flight; serve a short TTL cache
 * for the same key. Always returns a cloned doc list so callers can mutate safely.
 */
export async function withDocumentQuerySingleFlight(
  spec: QuerySpec,
  loader: () => Promise<StoredDoc[]>,
): Promise<StoredDoc[]> {
  const key = querySpecCacheKey(spec);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return cloneDocs(hit.docs);
  }

  const existing = inflight.get(key);
  if (existing) {
    return cloneDocs(await existing);
  }

  const promise = (async () => {
    const docs = await loader();
    cache.set(key, {
      expiresAt: Date.now() + DOCUMENT_QUERY_SINGLEFLIGHT_TTL_MS,
      docs: cloneDocs(docs),
    });
    return docs;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return cloneDocs(await promise);
}

/** Test helper — clear maps between cases. */
export function resetDocumentQuerySingleFlightForTests(): void {
  inflight.clear();
  cache.clear();
}
