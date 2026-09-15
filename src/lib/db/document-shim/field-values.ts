/** Sentinel markers for FieldValue operations (Postgres-backed Firestore shim). */

export const SERVER_TIMESTAMP = Symbol("SERVER_TIMESTAMP");
export const FIELD_DELETE = Symbol("FIELD_DELETE");

export type FieldValueSentinel = typeof SERVER_TIMESTAMP | typeof FIELD_DELETE;

export type IncrementSentinel = { __increment: number };
export type ArrayUnionSentinel = { __arrayUnion: unknown[] };
export type ArrayRemoveSentinel = { __arrayRemove: unknown[] };

export function isServerTimestamp(v: unknown): v is typeof SERVER_TIMESTAMP {
  return v === SERVER_TIMESTAMP;
}

export function isFieldDelete(v: unknown): v is typeof FIELD_DELETE {
  return v === FIELD_DELETE;
}

export function isIncrement(v: unknown): v is IncrementSentinel {
  return (
    typeof v === "object" &&
    v !== null &&
    "__increment" in v &&
    typeof (v as IncrementSentinel).__increment === "number"
  );
}

export function isArrayUnion(v: unknown): v is ArrayUnionSentinel {
  return typeof v === "object" && v !== null && "__arrayUnion" in v;
}

export function isArrayRemove(v: unknown): v is ArrayRemoveSentinel {
  return typeof v === "object" && v !== null && "__arrayRemove" in v;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Apply a single FieldValue / literal at a dotted path (`counts.created`).
 * Nested parents are shallow-cloned so sibling keys are preserved.
 */
function applyValueAtPath(
  root: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  let cur = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const seg = path[i]!;
    const next = cur[seg];
    if (!isPlainObject(next)) {
      cur[seg] = {};
    } else {
      cur[seg] = { ...next };
    }
    cur = cur[seg] as Record<string, unknown>;
  }
  const leaf = path[path.length - 1]!;
  if (isFieldDelete(value)) {
    delete cur[leaf];
    return;
  }
  if (isServerTimestamp(value)) {
    cur[leaf] = new Date();
    return;
  }
  if (isIncrement(value)) {
    const curVal = typeof cur[leaf] === "number" ? (cur[leaf] as number) : 0;
    cur[leaf] = curVal + value.__increment;
    return;
  }
  if (isArrayUnion(value)) {
    const list = Array.isArray(cur[leaf]) ? [...(cur[leaf] as unknown[])] : [];
    for (const item of value.__arrayUnion) {
      if (!list.some((x) => JSON.stringify(x) === JSON.stringify(item))) {
        list.push(item);
      }
    }
    cur[leaf] = list;
    return;
  }
  if (isArrayRemove(value)) {
    const list = Array.isArray(cur[leaf]) ? [...(cur[leaf] as unknown[])] : [];
    cur[leaf] = list.filter(
      (item) =>
        !value.__arrayRemove.some(
          (r) => JSON.stringify(r) === JSON.stringify(item),
        ),
    );
    return;
  }
  cur[leaf] = value;
}

export function applyFieldValues(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    const path = key.split(".").filter(Boolean);
    if (path.length === 0) continue;
    applyValueAtPath(out, path, value);
  }
  return out;
}

export function resolveWriteData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  // Expand dotted keys so set({ "counts.created": 1 }) nests under counts.
  return applyFieldValues({}, data);
}

export type VectorSentinel = { __vector: number[] };

export function isVector(v: unknown): v is VectorSentinel {
  return typeof v === "object" && v !== null && "__vector" in v;
}

/** Re-export for store — serializes Dates/Timestamps for JSONB storage. */
export { serializePayloadValue } from "@/lib/db/document-shim/timestamp";
