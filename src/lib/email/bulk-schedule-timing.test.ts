import { describe, expect, it } from "vitest";
import {
  isBulkScheduleStartInFuture,
  resolveBulkScheduleStartIso,
  shiftSequenceStepsToStart,
} from "@/lib/email/bulk-schedule-timing";

describe("resolveBulkScheduleStartIso", () => {
  const tz = "America/New_York";
  const now = new Date("2026-08-04T16:00:00.000Z");

  it("resolves tomorrow 9 AM", () => {
    const iso = resolveBulkScheduleStartIso({ preset: "tomorrow9", timeZone: tz, now });
    expect(iso).toBe("2026-08-05T13:00:00.000Z");
  });

  it("resolves next Monday 9 AM", () => {
    const iso = resolveBulkScheduleStartIso({ preset: "nextMonday9", timeZone: tz, now });
    expect(iso).toBe("2026-08-10T13:00:00.000Z");
  });

  it("resolves custom date and time", () => {
    const iso = resolveBulkScheduleStartIso({
      preset: "custom",
      timeZone: tz,
      customDate: "2026-08-07",
      customTime: "10:30",
    });
    expect(iso).toBe("2026-08-07T14:30:00.000Z");
  });

  it("returns empty when custom date is missing", () => {
    expect(
      resolveBulkScheduleStartIso({ preset: "custom", timeZone: tz, customTime: "09:00" }),
    ).toBe("");
  });
});

describe("isBulkScheduleStartInFuture", () => {
  it("requires at least one minute from now", () => {
    const now = Date.parse("2026-08-05T12:00:00.000Z");
    expect(isBulkScheduleStartInFuture("2026-08-05T12:00:30.000Z", now)).toBe(false);
    expect(isBulkScheduleStartInFuture("2026-08-05T12:01:00.000Z", now)).toBe(true);
  });
});

describe("shiftSequenceStepsToStart", () => {
  it("keeps gaps when moving the first step", () => {
    const shifted = shiftSequenceStepsToStart(
      [
        { id: "s2", dueAt: "2026-08-08T16:00:00.000Z" },
        { id: "s1", dueAt: "2026-08-01T16:00:00.000Z" },
        { id: "s3", dueAt: "2026-08-12T16:00:00.000Z" },
      ],
      "2026-08-06T13:00:00.000Z",
    );
    expect(shifted.map((s) => s.scheduledAt)).toEqual([
      "2026-08-06T13:00:00.000Z",
      "2026-08-13T13:00:00.000Z",
      "2026-08-17T13:00:00.000Z",
    ]);
    expect(shifted.every((s) => s.included)).toBe(true);
  });

  it("returns empty for invalid start or no steps", () => {
    expect(shiftSequenceStepsToStart([], "2026-08-06T13:00:00.000Z")).toEqual([]);
    expect(
      shiftSequenceStepsToStart([{ id: "s1", dueAt: "2026-08-01T16:00:00.000Z" }], "nope"),
    ).toEqual([]);
  });
});
