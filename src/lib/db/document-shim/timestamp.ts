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
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
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
    out[k] = v;
  }
  return out;
}

export { toDate };
