/**
 * Prefer explicit view-as (admin), else the active mailbox’s owner when it is an assigned box.
 */
export function resolveMailApiForUserUid(input: {
  mailViewAsUid: string | null | undefined;
  activeMailboxDataOwnerUid?: string | null | undefined;
  selfUid: string;
}): string | null {
  const viewAs = (input.mailViewAsUid ?? "").trim();
  if (viewAs && viewAs !== input.selfUid) return viewAs;
  const owner = (input.activeMailboxDataOwnerUid ?? "").trim();
  if (owner && owner !== input.selfUid) return owner;
  return null;
}

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
