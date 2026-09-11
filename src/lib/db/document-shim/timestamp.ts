import { toDate } from "@/lib/db/crm-types";

/** Postgres-backed Firestore Timestamp replacement. */
export class Timestamp {
  private readonly _date: Date;

  constructor(seconds: number, nanoseconds = 0) {
    this._date = new Date(seconds * 1000 + Math.floor(nanoseconds / 1e6));
  }

  get seconds(): number {
    return Math.floor(this._date.getTime() / 1000);
  }

  get nanoseconds(): number {
    return (this._date.getTime() % 1000) * 1e6;
  }

  static now(): Timestamp {
    return Timestamp.fromDate(new Date());
  }

  static fromDate(date: Date): Timestamp {
    const t = Object.create(Timestamp.prototype) as Timestamp;
    (t as unknown as { _date: Date })._date = date;
    return t;
  }

  static fromMillis(ms: number): Timestamp {
    return Timestamp.fromDate(new Date(ms));
  }

  toDate(): Date {
    return new Date(this._date.getTime());
  }

  toMillis(): number {
    return this._date.getTime();
  }

  isEqual(other: Timestamp): boolean {
    return this.toMillis() === other.toMillis();
  }

  valueOf(): string {
    return this.toDate().toISOString();
  }
}

export function toTimestamp(value: unknown): Timestamp | undefined {
  if (value instanceof Timestamp) return value;
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return Timestamp.fromDate(d);
  }
  if (value && typeof value === "object" && "toDate" in value) {
    try {
      const d = (value as { toDate: () => Date }).toDate();
      if (d instanceof Date) return Timestamp.fromDate(d);
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/** Serialize payload values for JSON storage (Dates → ISO, Timestamp → ISO). */
export function serializePayloadValue(value: unknown): unknown {
  if (value instanceof Timestamp) {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? value.toISOString() : null;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) return value.map(serializePayloadValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializePayloadValue(v);
    }
    return out;
  }
  return value;
}

/**
 * List/snapshot projection for workspace-documents GET.
 * Omits heavy email HTML so live polls stay under gateway limits.
 */
export function projectWorkspaceListPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const data = serializePayloadValue(payload) as Record<string, unknown>;
  const body = data.messageBody;
  if (typeof body === "string") {
    if (body.trim()) {
      data.hasMessageBody = true;
    }
    delete data.messageBody;
  }
  return data;
}

/** Firestore-export / Admin SDK JSON timestamp shapes. */
function coerceFirestoreTimestampObjectMs(value: object): number | null {
  const v = value as Record<string, unknown>;
  const seconds =
    typeof v._seconds === "number"
      ? v._seconds
      : typeof v.seconds === "number"
        ? v.seconds
        : null;
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const nanos =
    typeof v._nanoseconds === "number"
      ? v._nanoseconds
      : typeof v.nanoseconds === "number"
        ? v.nanoseconds
        : 0;
  const ms = seconds * 1000 + Math.floor((Number.isFinite(nanos) ? nanos : 0) / 1e6);
  return Number.isFinite(ms) ? ms : null;
}

/** Deserialize stored JSON into runtime objects (ISO strings → Timestamp where needed). */
export function deserializePayload(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime()) && k.endsWith("At")) {
        out[k] = Timestamp.fromDate(d);
        continue;
      }
    }
    if (v && typeof v === "object" && k.endsWith("At")) {
      const ms = coerceFirestoreTimestampObjectMs(v);
      if (ms != null) {
        out[k] = Timestamp.fromMillis(ms);
        continue;
      }
    }
    out[k] = v;
  }
  return out;
}

/**
 * Normalize Timestamp / Date / ISO / accidental `{_date}` / Firestore `{_seconds}` JSON to epoch ms.
 * Used by document-shim query filters so `scheduledAt <= now` works after deserialize.
 */
export function coerceInstantMs(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Timestamp) {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const ms = new Date(value.trim()).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (value && typeof value === "object") {
    if ("toMillis" in value && typeof (value as { toMillis: unknown }).toMillis === "function") {
      try {
        const ms = (value as { toMillis: () => number }).toMillis();
        return Number.isFinite(ms) ? ms : null;
      } catch {
        /* fall through */
      }
    }
    if ("toDate" in value && typeof (value as { toDate: unknown }).toDate === "function") {
      try {
        const d = (value as { toDate: () => Date }).toDate();
        if (d instanceof Date) {
          const ms = d.getTime();
          return Number.isNaN(ms) ? null : ms;
        }
      } catch {
        /* fall through */
      }
    }
    if ("_date" in value) {
      const raw = (value as { _date: unknown })._date;
      if (typeof raw === "string" || raw instanceof Date) {
        return coerceInstantMs(raw);
      }
    }
    const firestoreMs = coerceFirestoreTimestampObjectMs(value);
    if (firestoreMs != null) return firestoreMs;
  }
  return null;
}

/** ISO UTC string for API responses / comparisons (never `String(Timestamp)` → `[object Object]`). */
export function coerceIsoInstant(value: unknown): string {
  const ms = coerceInstantMs(value);
  if (ms == null) return typeof value === "string" ? value.trim() : "";
  return new Date(ms).toISOString();
}

export { toDate };
