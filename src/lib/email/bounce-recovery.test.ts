import { describe, expect, it } from "vitest";
import {
  computeRerouteDueAts,
  isReroutableFollowup,
  resolveBounceRecoveryAction,
  resolveFailoverToEmail,
} from "@/lib/email/bounce-recovery";

describe("resolveBounceRecoveryAction", () => {
  it("fails over to personal on first bounce when personal is clean", () => {
    expect(
      resolveBounceRecoveryAction({
        bounceCountAfter: 1,
        companyEmail: "a@co.com",
        personalEmail: "a@gmail.com",
        failedRecipients: ["a@co.com"],
        linkedin: "https://linkedin.com/in/a",
      }),
    ).toBe("failover_personal");
  });

  it("pauses for fix email on first bounce without personal", () => {
    expect(
      resolveBounceRecoveryAction({
        bounceCountAfter: 1,
        companyEmail: "a@co.com",
        failedRecipients: ["a@co.com"],
      }),
    ).toBe("pause_fix_email");
  });

  it("does not failover when personal itself bounced", () => {
    expect(
      resolveBounceRecoveryAction({
        bounceCountAfter: 1,
        companyEmail: "a@co.com",
        personalEmail: "a@gmail.com",
        failedRecipients: ["a@gmail.com"],
      }),
    ).toBe("pause_fix_email");
  });

  it("suggests LinkedIn on second bounce when URL exists", () => {
    expect(
      resolveBounceRecoveryAction({
        bounceCountAfter: 2,
        companyEmail: "a@co.com",
        personalEmail: "a@gmail.com",
        failedRecipients: ["a@gmail.com"],
        linkedin: "https://linkedin.com/in/a",
      }),
    ).toBe("pause_linkedin");
  });

  it("asks to find email on second bounce without LinkedIn", () => {
    expect(
      resolveBounceRecoveryAction({
        bounceCountAfter: 2,
        companyEmail: "a@co.com",
        failedRecipients: ["a@co.com"],
      }),
    ).toBe("pause_find_email");
  });
});

describe("resolveFailoverToEmail", () => {
  it("returns personal when distinct", () => {
    expect(
      resolveFailoverToEmail({ email: "a@co.com", personalEmail: "a@gmail.com" }),
    ).toBe("a@gmail.com");
  });

  it("returns null when personal equals company", () => {
    expect(
      resolveFailoverToEmail({ email: "a@co.com", personalEmail: "a@co.com" }),
    ).toBeNull();
  });
});

describe("isReroutableFollowup", () => {
  it("excludes sent and completed steps", () => {
    expect(isReroutableFollowup({ completedAt: "x" })).toBe(false);
    expect(isReroutableFollowup({ sentAt: "x" })).toBe(false);
    expect(isReroutableFollowup({ sentMessageId: "mid" })).toBe(false);
    expect(isReroutableFollowup({ deliveryStatus: "sent" })).toBe(false);
    expect(isReroutableFollowup({})).toBe(true);
  });
});

describe("computeRerouteDueAts", () => {
  it("returns one dueAt per step", () => {
    const from = new Date("2026-07-20T12:00:00Z"); // Monday
    const dues = computeRerouteDueAts(3, from, "UTC");
    expect(dues).toHaveLength(3);
    expect(dues[0]).toContain("2026-07-20");
  });

  it("anchors noon in the given org timezone", () => {
    const from = new Date("2026-07-20T12:00:00Z");
    const dues = computeRerouteDueAts(1, from, "America/New_York");
    // Noon EDT = 16:00Z
    expect(dues[0]).toBe("2026-07-20T16:00:00.000Z");
  });
});
