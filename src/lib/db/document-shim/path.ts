/** Parse Firestore-style document paths. */

export type ParsedPath = {
  path: string;
  collectionRoot: string;
  organizationId: string | null;
  segments: string[];
};

export function buildPath(segments: string[]): string {
  return segments.join("/");
}

export function parsePath(path: string): ParsedPath {
  const segments = path.split("/").filter(Boolean);
  const collectionRoot = segments[0] ?? "";
  let organizationId: string | null = null;

  if (collectionRoot === "organizations" && segments.length >= 2) {
    organizationId = segments[1] ?? null;
  } else if (segments.length >= 1) {
    // Flat tenant collections carry organizationId in payload; indexed when known at write.
    organizationId = null;
  }

  return { path, collectionRoot, organizationId, segments };
}

export function extractOrganizationId(
  collectionRoot: string,
  segments: string[],
  payload: Record<string, unknown>,
): string | null {
  if (collectionRoot === "organizations" && segments.length >= 2) {
    return segments[1] ?? null;
  }
  const orgId = payload.organizationId;
  return typeof orgId === "string" && orgId.trim() ? orgId : null;
}

export function collectionPathFromSegments(segments: string[]): string {
  if (segments.length === 0) return "";
  if (segments.length === 1) return segments[0]!;
  // organizations/{orgId}/subcollection
  if (segments[0] === "organizations" && segments.length >= 3) {
    return `${segments[0]}/${segments[1]}/${segments[2]}`;
  }
  return segments[0]!;
}

/**
 * Firestore `collection(path).get()` returns only immediate documents under that
 * collection — not nested subcollection docs (e.g. mailbox sendStats / inboxSync).
 */
export function isImmediateCollectionDocument(
  docPath: string,
  collectionPath: string,
): boolean {
  const prefix = collectionPath.replace(/\/+$/, "");
  if (!prefix) return false;
  const expected = `${prefix}/`;
  if (!docPath.startsWith(expected)) return false;
  const rest = docPath.slice(expected.length);
  return rest.length > 0 && !rest.includes("/");
}

/**
 * Firestore collection group: the document's parent collection id equals `groupName`.
 * Document paths alternate collection/doc and have an even segment count.
 */
export function pathMatchesCollectionGroup(path: string, groupName: string): boolean {
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2 || segments.length % 2 !== 0) return false;
  return segments[segments.length - 2] === groupName;
}
