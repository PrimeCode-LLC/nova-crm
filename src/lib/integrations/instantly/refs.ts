/** Format Nova externalRef for an Instantly campaign UUID. */
export function formatInstantlyRef(instantlyId: string): string {
  return `instantly:${instantlyId.trim()}`;
}

/** Parse Instantly UUID from externalRef or instantlyId field. */
export function parseInstantlyId(
  externalRef?: string | null,
  instantlyId?: string | null,
): string | null {
  if (instantlyId?.trim()) return instantlyId.trim();
  if (!externalRef?.startsWith("instantly:")) return null;
  const slug = externalRef.slice("instantly:".length).trim();
  return slug || null;
}
