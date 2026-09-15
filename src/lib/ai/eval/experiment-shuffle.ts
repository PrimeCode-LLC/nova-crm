/**
 * Isomorphic deterministic shuffle for experiment confound control
 * (works in browser + Node — no node:crypto).
 */

function fnv1aHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Expand a bit for sort stability
  let h2 = h >>> 0;
  let out = h2.toString(16).padStart(8, "0");
  h2 = Math.imul(h2 ^ (h2 >>> 16), 0x45d9f3b) >>> 0;
  out += h2.toString(16).padStart(8, "0");
  return out;
}

/** Deterministic shuffle so arms interleave across mailbox round-robin. */
export function interleaveLeadIdsForExperiment(
  experimentId: string,
  leadIds: string[],
): string[] {
  return [...leadIds].sort((a, b) =>
    fnv1aHex(`${experimentId}:shuffle:${a}`).localeCompare(
      fnv1aHex(`${experimentId}:shuffle:${b}`),
    ),
  );
}

export function reorderByExperimentShuffle<T>(input: {
  experimentId: string;
  items: T[];
  leadIdOf: (item: T) => string;
}): T[] {
  const byLead = new Map<string, T[]>();
  for (const item of input.items) {
    const id = input.leadIdOf(item);
    const list = byLead.get(id) ?? [];
    list.push(item);
    byLead.set(id, list);
  }
  const orderedIds = interleaveLeadIdsForExperiment(input.experimentId, [
    ...byLead.keys(),
  ]);
  const out: T[] = [];
  for (const id of orderedIds) {
    const list = byLead.get(id);
    if (list) out.push(...list);
  }
  return out;
}
