/** Format Nova externalRef for an Instantly campaign UUID. */
export function formatInstantlyRef(instantlyId: string): string {
  return `instantly:${instantlyId.trim()}`;
}

/** Parse Instantly UUID from externalRef or instantlyId field. */
export function parseInstantlyId(
  externalRef?: string | null,
  instantlyId?: string | null,
): string | null {
  const direct = instantlyId?.trim();
  if (direct) {
    if (direct.startsWith("demo-")) return null;
    return direct;
  }
  if (!externalRef?.startsWith("instantly:")) return null;
  const slug = externalRef.slice("instantly:".length).trim();
  if (!slug || slug.startsWith("demo-")) return null;
  return slug;
}
