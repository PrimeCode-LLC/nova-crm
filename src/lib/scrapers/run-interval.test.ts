import { describe, expect, it } from "vitest";
import {
  decomposeRunIntervalMinutes,
  normalizeRunInterval,
  runIntervalToMinutes,
} from "./run-interval";

describe("run-interval", () => {
  it("converts units to minutes", () => {
    expect(runIntervalToMinutes(2, "hours")).toBe(120);
    expect(runIntervalToMinutes(1, "days")).toBe(1440);
  });

  it("normalizes value + unit", () => {
    expect(normalizeRunInterval({ runIntervalValue: 3, runIntervalUnit: "hours" })).toEqual({
      runIntervalValue: 3,
      runIntervalUnit: "hours",
      runIntervalMinutes: 180,
    });
  });

  it("decomposes legacy minutes for display", () => {
    expect(decomposeRunIntervalMinutes(1440)).toEqual({ value: 1, unit: "days" });
    expect(decomposeRunIntervalMinutes(120)).toEqual({ value: 2, unit: "hours" });
  });
});
