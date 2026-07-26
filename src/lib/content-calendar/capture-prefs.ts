/** Browser prefs for Capture: last/preferred knowledge libraries per person. */

export type ContentCapturePrefs = {
  lastLibraryId?: string;
  /** Recently used library ids, newest first (person's habitual targets). */
  preferredLibraryIds: string[];
};

const MAX_PREFERRED = 8;

export function capturePrefsStorageKey(organizationId: string, userId: string): string {
  return `content-capture-prefs:${organizationId}:${userId}`;
}

export function loadCapturePrefs(
  organizationId: string | undefined,
  userId: string | undefined,
): ContentCapturePrefs {
  if (typeof window === "undefined" || !organizationId || !userId) {
    return { preferredLibraryIds: [] };
  }
  try {
    const raw = localStorage.getItem(capturePrefsStorageKey(organizationId, userId));
    if (!raw) return { preferredLibraryIds: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { preferredLibraryIds: [] };
    const o = parsed as Record<string, unknown>;
    const lastLibraryId =
      typeof o.lastLibraryId === "string" && o.lastLibraryId.trim()
        ? o.lastLibraryId.trim()
        : undefined;
    const preferredLibraryIds = Array.isArray(o.preferredLibraryIds)
      ? o.preferredLibraryIds
          .filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
          .map((id) => id.trim())
          .slice(0, MAX_PREFERRED)
      : [];
    return { lastLibraryId, preferredLibraryIds };
  } catch {
    return { preferredLibraryIds: [] };
  }
}

export function rememberCaptureLibrary(
  organizationId: string | undefined,
  userId: string | undefined,
  libraryId: string,
): ContentCapturePrefs {
  const id = libraryId.trim();
  const prev = loadCapturePrefs(organizationId, userId);
  if (!id || typeof window === "undefined" || !organizationId || !userId) return prev;

  const preferredLibraryIds = [id, ...prev.preferredLibraryIds.filter((x) => x !== id)].slice(
    0,
    MAX_PREFERRED,
  );
  const next: ContentCapturePrefs = { lastLibraryId: id, preferredLibraryIds };
  try {
    localStorage.setItem(capturePrefsStorageKey(organizationId, userId), JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}

/** Sort libraries so this person's preferred/last targets appear first. */
export function sortLibrariesForCapturePerson<T extends { id: string }>(
  libraries: T[],
  prefs: ContentCapturePrefs,
  brandLibraryIds?: string[],
): T[] {
  const rank = new Map<string, number>();
  let n = 0;
  if (prefs.lastLibraryId) rank.set(prefs.lastLibraryId, n++);
  for (const id of prefs.preferredLibraryIds) {
    if (!rank.has(id)) rank.set(id, n++);
  }
  for (const id of brandLibraryIds ?? []) {
    if (!rank.has(id)) rank.set(id, n++);
  }
  return [...libraries].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id)! : 10_000;
    const rb = rank.has(b.id) ? rank.get(b.id)! : 10_000;
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id);
  });
}
