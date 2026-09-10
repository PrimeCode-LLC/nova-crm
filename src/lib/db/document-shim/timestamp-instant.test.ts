import { describe, expect, it } from "vitest";
import {
  coerceInstantMs,
  coerceIsoInstant,
  Timestamp,
} from "@/lib/db/document-shim/timestamp";

describe("coerceInstantMs / coerceIsoInstant", () => {
  it("reads Timestamp and ISO the same way", () => {
    const iso = "2026-09-09T15:25:00.000Z";
    const ts = Timestamp.fromDate(new Date(iso));
    expect(coerceInstantMs(ts)).toBe(Date.parse(iso));
    expect(coerceInstantMs(iso)).toBe(Date.parse(iso));
    expect(coerceIsoInstant(ts)).toBe(iso);
  });

  it("supports accidental {_date} JSON shapes", () => {
    const iso = "2026-09-09T15:25:00.000Z";
    expect(coerceIsoInstant({ _date: iso })).toBe(iso);
  });

  it("supports Firestore export {_seconds,_nanoseconds} shapes", () => {
    const iso = "2026-09-09T15:25:00.000Z";
    const seconds = Math.floor(Date.parse(iso) / 1000);
    expect(coerceIsoInstant({ _seconds: seconds, _nanoseconds: 0 })).toBe(iso);
    expect(coerceInstantMs({ seconds, nanoseconds: 0 })).toBe(Date.parse(iso));
  });

  it("compares due scheduledAt against now without [object Object]", () => {
    const past = Timestamp.fromDate(new Date(Date.now() - 60_000));
    const nowIso = new Date().toISOString();
    const pastMs = coerceInstantMs(past);
    const nowMs = coerceInstantMs(nowIso);
    expect(pastMs).not.toBeNull();
    expect(nowMs).not.toBeNull();
    expect(pastMs!).toBeLessThanOrEqual(nowMs!);
    expect(String(past)).toBe("[object Object]");
    expect(coerceIsoInstant(past)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
