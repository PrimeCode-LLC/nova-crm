/**
 * Append `forUser` when an admin / owner is viewing another member’s mailbox APIs.
 * Use the viewer’s own uid (no query param) when viewing self.
 */
export function appendMailDataOwnerParam(
  pathWithOptionalQuery: string,
  forUid: string | null | undefined,
  selfUid: string,
): string {
  if (!forUid || forUid === selfUid) return pathWithOptionalQuery;
  const sep = pathWithOptionalQuery.includes("?") ? "&" : "?";
  return `${pathWithOptionalQuery}${sep}forUser=${encodeURIComponent(forUid)}`;
}
