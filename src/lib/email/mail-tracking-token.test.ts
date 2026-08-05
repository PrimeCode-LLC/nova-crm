import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  signMailTrackingToken,
  verifyMailTrackingToken,
  getMailTrackingBaseUrl,
} from "@/lib/email/mail-tracking-token";
import { injectMailTracking } from "@/lib/email/mail-tracking-inject";

describe("mail-tracking-token", () => {
  const prev = {
    secret: process.env.MAIL_TRACKING_SECRET,
    email: process.env.EMAIL_SECRETS_KEY_BASE64,
    base: process.env.MAIL_TRACKING_BASE_URL,
    site: process.env.NEXT_PUBLIC_SITE_URL,
  };

  beforeEach(() => {
    process.env.MAIL_TRACKING_SECRET = Buffer.from("0123456789abcdef0123456789abcdef").toString(
      "base64",
    );
    process.env.MAIL_TRACKING_BASE_URL = "https://track.example.com";
    delete process.env.EMAIL_SECRETS_KEY_BASE64;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries({
      MAIL_TRACKING_SECRET: prev.secret,
      EMAIL_SECRETS_KEY_BASE64: prev.email,
      MAIL_TRACKING_BASE_URL: prev.base,
      NEXT_PUBLIC_SITE_URL: prev.site,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("signs and verifies open tokens", () => {
    const token = signMailTrackingToken({ t: "o", id: "trk-1" });
    expect(token).toBeTruthy();
    const payload = verifyMailTrackingToken(token!);
    expect(payload).toMatchObject({ v: 1, t: "o", id: "trk-1" });
  });

  it("round-trips recipient ids on open tokens", () => {
    const token = signMailTrackingToken({ t: "o", id: "trk-1", r: "ab12cd34" });
    expect(verifyMailTrackingToken(token!)).toMatchObject({
      t: "o",
      id: "trk-1",
      r: "ab12cd34",
    });
  });

  it("requires link id for click tokens", () => {
    const token = signMailTrackingToken({ t: "c", id: "trk-1", l: "ab12" });
    const payload = verifyMailTrackingToken(token!);
    expect(payload).toMatchObject({ t: "c", id: "trk-1", l: "ab12" });
  });

  it("rejects tampered tokens", () => {
    const token = signMailTrackingToken({ t: "o", id: "trk-1" })!;
    const [body] = token.split(".");
    expect(verifyMailTrackingToken(`${body}.AAAA`)).toBeNull();
  });

  it("rejects expired tokens", () => {
    const now = 1_700_000_000;
    const token = signMailTrackingToken({ t: "o", id: "trk-1", exp: now - 1 }, now)!;
    expect(verifyMailTrackingToken(token, now)).toBeNull();
  });

  it("reads tracking base url from env", () => {
    expect(getMailTrackingBaseUrl()).toBe("https://track.example.com");
  });
});

describe("injectMailTracking", () => {
  const prev = process.env.MAIL_TRACKING_SECRET;

  beforeEach(() => {
    process.env.MAIL_TRACKING_SECRET = Buffer.from("0123456789abcdef0123456789abcdef").toString(
      "base64",
    );
    process.env.MAIL_TRACKING_BASE_URL = "https://track.example.com";
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.MAIL_TRACKING_SECRET;
    else process.env.MAIL_TRACKING_SECRET = prev;
  });

  it("rewrites http links and appends open pixel", () => {
    const html = `<p>Hi <a href="https://example.com/x">here</a></p>`;
    const result = injectMailTracking({
      html,
      trackingId: "trk-1",
      trackOpens: true,
      trackClicks: true,
    });
    expect(result.links).toHaveLength(1);
    expect(result.links[0]?.url).toBe("https://example.com/x");
    expect(result.html).toContain("https://track.example.com/api/t/c/");
    expect(result.html).toContain('src="https://track.example.com/api/t/o/');
    expect(result.html).not.toContain('href="https://example.com/x"');
  });

  it("personalizes tokens per recipient while reusing link ids", () => {
    const html = `<p>Hi <a href="https://example.com/x">here</a></p>`;
    const base = injectMailTracking({
      html,
      trackingId: "trk-1",
      trackOpens: true,
      trackClicks: true,
    });
    const first = injectMailTracking({
      html,
      trackingId: "trk-1",
      trackOpens: true,
      trackClicks: true,
      recipientId: "rec-a",
      links: base.links,
    });
    const second = injectMailTracking({
      html,
      trackingId: "trk-1",
      trackOpens: true,
      trackClicks: true,
      recipientId: "rec-b",
      links: base.links,
    });
    expect(first.html).not.toBe(second.html);
    const openToken = first.html.match(/\/api\/t\/o\/([^"']+)/)?.[1];
    expect(openToken).toBeTruthy();
    expect(verifyMailTrackingToken(decodeURIComponent(openToken!))).toMatchObject({
      t: "o",
      id: "trk-1",
      r: "rec-a",
    });
  });

  it("skips mailto and hash links", () => {
    const html = `<a href="mailto:a@b.com">m</a><a href="#top">t</a>`;
    const result = injectMailTracking({
      html,
      trackingId: "trk-1",
      trackOpens: false,
      trackClicks: true,
    });
    expect(result.links).toHaveLength(0);
    expect(result.html).toContain('href="mailto:a@b.com"');
  });

  it("does nothing when both flags are off", () => {
    const html = `<a href="https://example.com">x</a>`;
    const result = injectMailTracking({
      html,
      trackingId: "trk-1",
      trackOpens: false,
      trackClicks: false,
    });
    expect(result.html).toBe(html);
    expect(result.links).toHaveLength(0);
  });
});
