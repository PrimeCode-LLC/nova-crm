import { describe, expect, it } from "vitest";
import {
  countryFromPhone,
  deriveContactTimezone,
  timezoneFromCountryCode,
} from "@/lib/email/contact-timezone";
import { normalizeSuppressionEmail } from "@/lib/email/suppression-server";
import {
  resolveIdempotencyKey,
  rowToScheduledEmail,
} from "@/lib/email/scheduled-emails-repo";
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from "@/lib/email/unsubscribe-token";

describe("contact timezone derivation", () => {
  it("maps country codes", () => {
    expect(timezoneFromCountryCode("PK")).toBe("Asia/Karachi");
    expect(timezoneFromCountryCode("us")).toBe("America/New_York");
  });

  it("derives from phone prefixes", () => {
    expect(countryFromPhone("+92 300 1234567")).toBe("PK");
    expect(deriveContactTimezone({ phone: "+44 7700 900123" })).toBe("Europe/London");
  });

  it("prefers explicit timezone", () => {
    expect(
      deriveContactTimezone({
        timezone: "Asia/Tokyo",
        country: "US",
        phone: "+44 1",
      }),
    ).toBe("Asia/Tokyo");
  });
});

describe("suppression email normalize", () => {
  it("lowercases and trims", () => {
    expect(normalizeSuppressionEmail("  Foo@Example.COM ")).toBe("foo@example.com");
  });
});

describe("scheduled email idempotency", () => {
  it("uses followupId when present", () => {
    expect(resolveIdempotencyKey({ id: "sch-1", followupId: "fu-9" })).toBe("fu-9");
    expect(resolveIdempotencyKey({ id: "sch-1", followupId: "  " })).toBe("sch-1");
  });
});

describe("rowToScheduledEmail", () => {
  it("maps payload fields onto ScheduledEmail", () => {
    const mapped = rowToScheduledEmail({
      id: "sch-1",
      organizationId: "org-1",
      mailboxOwnerUid: "u-1",
      mailboxId: "mb-1",
      scheduledByUserId: "u-2",
      followupId: "fu-1",
      leadId: "lead-1",
      status: "pending",
      scheduledAt: new Date("2026-09-11T12:00:00.000Z"),
      notBeforeAt: null,
      attempts: 0,
      failureKind: null,
      leaseUntil: null,
      leaseId: null,
      idempotencyKey: "fu-1",
      toEmail: "a@b.com",
      fromEmail: "from@b.com",
      subject: "Hi",
      messageId: null,
      sentAt: null,
      cancelledAt: null,
      cancelReason: null,
      error: null,
      lastSkipReason: null,
      payload: {
        body: "hello",
        text: "hello",
        html: "<p>hello</p>",
        displayName: "Sales",
      },
      createdAt: new Date("2026-09-11T11:00:00.000Z"),
      updatedAt: new Date("2026-09-11T11:00:00.000Z"),
    });
    expect(mapped).toMatchObject({
      id: "sch-1",
      uid: "u-1",
      to: "a@b.com",
      from: "from@b.com",
      subject: "Hi",
      body: "hello",
      displayName: "Sales",
      status: "pending",
      followupId: "fu-1",
    });
  });
});

describe("unsubscribe token", () => {
  const prev = process.env.MAIL_TRACKING_SECRET;

  it("round-trips", () => {
    process.env.MAIL_TRACKING_SECRET = Buffer.from(
      "0123456789abcdef0123456789abcdef",
    ).toString("base64");
    try {
      const token = signUnsubscribeToken({
        organizationId: "org-1",
        email: "lead@example.com",
        leadId: "lead-1",
      });
      expect(token).toBeTruthy();
      expect(verifyUnsubscribeToken(token!)).toMatchObject({
        t: "u",
        organizationId: "org-1",
        email: "lead@example.com",
        leadId: "lead-1",
      });
    } finally {
      if (prev === undefined) delete process.env.MAIL_TRACKING_SECRET;
      else process.env.MAIL_TRACKING_SECRET = prev;
    }
  });

  it("rejects tampering", () => {
    process.env.MAIL_TRACKING_SECRET = Buffer.from(
      "0123456789abcdef0123456789abcdef",
    ).toString("base64");
    try {
      const token = signUnsubscribeToken({
        organizationId: "org-1",
        email: "lead@example.com",
      })!;
      expect(verifyUnsubscribeToken(`${token.slice(0, -4)}AAAA`)).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.MAIL_TRACKING_SECRET;
      else process.env.MAIL_TRACKING_SECRET = prev;
    }
  });
});
