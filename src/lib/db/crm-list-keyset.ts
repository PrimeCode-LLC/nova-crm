/**
 * Pure helpers for cursor-paginated CRM list merge/dedup (Phase 5).
 */

export type KeysetSortRow = {
  id: string;
  updatedAt: string;
};

/** Merge paginated rows by id (last write wins) — handles duplicate rows across pages. */
export function mergeCrmListPagesById<T extends { id: string }>(pages: readonly (readonly T[])[]): T[] {
  const byId = new Map<string, T>();
  for (const page of pages) {
    for (const row of page) {
      const id = row?.id?.trim();
      if (id) byId.set(id, row);
    }
  }
  return Array.from(byId.values());
}

/**
 * When a row's `updatedAt` moves forward between page fetches, it may appear on
 * both page N and page N+1. Dedup by id keeps a single copy.
 */
export function keysetDuplicateIdsAcrossPages(
  pageA: readonly KeysetSortRow[],
  pageB: readonly KeysetSortRow[],
): string[] {
  const idsB = new Set(pageB.map((r) => r.id));
  return pageA.filter((r) => idsB.has(r.id)).map((r) => r.id);
}

/** Rows strictly before the cursor in (updatedAt desc, id desc) order. */
export function keysetRowBeforeCursor(
  row: KeysetSortRow,
  cursor: { updatedAt: Date; id: string },
): boolean {
  const rowAt = Date.parse(row.updatedAt);
  const curAt = cursor.updatedAt.getTime();
  if (!Number.isFinite(rowAt)) return false;
  if (rowAt < curAt) return true;
  if (rowAt > curAt) return false;
  return row.id < cursor.id;
}
