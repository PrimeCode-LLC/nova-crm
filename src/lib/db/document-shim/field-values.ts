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

export function applyFieldValues(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (isFieldDelete(value)) {
      delete out[key];
      continue;
    }
    if (isServerTimestamp(value)) {
      out[key] = new Date();
      continue;
    }
    if (isIncrement(value)) {
      const cur = typeof out[key] === "number" ? (out[key] as number) : 0;
      out[key] = cur + value.__increment;
      continue;
    }
    if (isArrayUnion(value)) {
      const cur = Array.isArray(out[key]) ? [...(out[key] as unknown[])] : [];
      for (const item of value.__arrayUnion) {
        if (!cur.some((x) => JSON.stringify(x) === JSON.stringify(item))) {
          cur.push(item);
        }
      }
      out[key] = cur;
      continue;
    }
    if (isArrayRemove(value)) {
      const cur = Array.isArray(out[key]) ? [...(out[key] as unknown[])] : [];
      out[key] = cur.filter(
        (item) =>
          !value.__arrayRemove.some(
            (r) => JSON.stringify(r) === JSON.stringify(item),
          ),
      );
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function resolveWriteData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (isFieldDelete(value)) continue;
    if (isServerTimestamp(value)) {
      out[key] = new Date();
    } else if (isIncrement(value)) {
      out[key] = value.__increment;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export type VectorSentinel = { __vector: number[] };

export function isVector(v: unknown): v is VectorSentinel {
  return typeof v === "object" && v !== null && "__vector" in v;
}

/** Re-export for store — serializes Dates/Timestamps for JSONB storage. */
export { serializePayloadValue } from "@/lib/db/document-shim/timestamp";
