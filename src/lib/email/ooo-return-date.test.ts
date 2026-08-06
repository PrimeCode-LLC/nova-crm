import { describe, expect, it } from "vitest";
import {
  hasActiveFollowUpAfterDate,
  normalizeWaitUntilDate,
  parseOooReturnDate,
  resolveWaitUntilDate,
  sequenceCadenceStartFromWaitUntil,
} from "@/lib/email/ooo-return-date";
import { dateInputForSequenceStep } from "@/lib/followup-date";

describe("parseOooReturnDate", () => {
  it("reads 'out of office until August 20'", () => {
    expect(
      parseOooReturnDate("I am out of office until August 20 and will reply then.", {
        today: "2026-08-06",
      }),
    ).toBe("2026-08-20");
  });

  it("reads 'back on 20/08/2026' style European dates when cued", () => {
    expect(
      parseOooReturnDate("Automatic reply: I will be back on 20/08/2026.", {
        today: "2026-08-06",
      }),
    ).toBe("2026-08-20");
  });

  it("rolls a bare month/day into next year when already past", () => {
    expect(
      parseOooReturnDate("Out of office until January 5. Back then.", {
        today: "2026-08-06",
      }),
    ).toBe("2027-01-05");
  });

  it("ignores dates that are not near a return cue", () => {
    expect(
      parseOooReturnDate("Sent from my iPhone. Contract dated August 20, 2026.", {
        today: "2026-08-06",
      }),
    ).toBeNull();
  });

  it("prefers the AI structured date when valid", () => {
    expect(
      resolveWaitUntilDate({
        aiWaitUntilDate: "2026-09-01",
        body: "out until forever",
        today: "2026-08-06",
      }),
    ).toBe("2026-09-01");
  });

  it("falls back to heuristic when AI left waitUntilDate blank", () => {
    expect(
      resolveWaitUntilDate({
        aiWaitUntilDate: "",
        body: "I am away until Sept 12th.",
        today: "2026-08-06",
      }),
    ).toBe("2026-09-12");
  });
});

describe("sequenceCadenceStartFromWaitUntil", () => {
  it("starts the cadence on the return day, not today", () => {
    const from = sequenceCadenceStartFromWaitUntil({
      followUpAfterDate: "2026-08-20",
      timeZone: "UTC",
      now: new Date("2026-08-06T12:00:00.000Z"),
    });
    expect(dateInputForSequenceStep(0, { includeInitial: true, from, timeZone: "UTC" })).toBe(
      "2026-08-20",
    );
    expect(dateInputForSequenceStep(1, { includeInitial: true, from, timeZone: "UTC" })).toBe(
      "2026-08-25",
    );
  });

  it("ignores a past wait date", () => {
    expect(
      hasActiveFollowUpAfterDate("2026-07-01", "UTC", new Date("2026-08-06T12:00:00.000Z")),
    ).toBe(false);
    expect(normalizeWaitUntilDate("not-a-date")).toBeNull();
  });
});
