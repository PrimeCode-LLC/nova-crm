import { describe, expect, it } from "vitest";
import {
  emailVerificationDescription,
  emailVerificationFilterBucket,
  emailVerificationLabel,
  resolveEmailVerificationStatus,
  shouldOfferEmailVerify,
} from "./email-verification-status";
import type { Contact, Lead } from "@/lib/types";

describe("resolveEmailVerificationStatus", () => {
  it("ignores manual contact status without provider source", () => {
    expect(
      resolveEmailVerificationStatus({
        emailVerificationStatus: "verified",
        emailVerified: true,
      } as Contact),
    ).toBe("not_verified");
    expect(
      resolveEmailVerificationStatus({
        emailVerificationStatus: "verified",
        emailVerificationSource: "manual",
        emailVerified: true,
      } as Contact),
    ).toBe("not_verified");
  });

  it("uses millionverifier source on lead or contact", () => {
    expect(
      resolveEmailVerificationStatus(undefined, {
        emailVerificationStatus: "verified",
        emailVerificationSource: "millionverifier",
      } as Lead),
    ).toBe("verified");
    expect(
      resolveEmailVerificationStatus({
        emailVerificationStatus: "bounced",
        emailVerificationSource: "millionverifier",
      } as Contact),
    ).toBe("bounced");
    expect(
      resolveEmailVerificationStatus({
        emailVerificationStatus: "catch_all",
        emailVerificationSource: "millionverifier",
      } as Contact),
    ).toBe("catch_all");
  });

  it("uses bounce source", () => {
    expect(
      resolveEmailVerificationStatus(undefined, {
        emailVerificationStatus: "bounced",
        emailVerificationSource: "bounce",
      } as Lead),
    ).toBe("bounced");
  });

  it("does not treat lead.emailVerified alone as verified", () => {
    expect(
      resolveEmailVerificationStatus(undefined, { emailVerified: true } as Lead),
    ).toBe("not_verified");
  });
});

describe("shouldOfferEmailVerify", () => {
  it("hides verify when already verified", () => {
    expect(shouldOfferEmailVerify("verified")).toBe(false);
    expect(shouldOfferEmailVerify("not_verified")).toBe(true);
  });
});

describe("emailVerificationLabel", () => {
  it("returns readable labels", () => {
    expect(emailVerificationLabel("verified")).toBe("Verified");
    expect(emailVerificationLabel("not_verified")).toBe("Not verified");
    expect(emailVerificationLabel("catch_all")).toBe("Risky (catch-all)");
    expect(emailVerificationLabel("bounced")).toBe("Invalid");
  });
});

describe("emailVerificationDescription", () => {
  it("explains catch-all risk", () => {
    expect(emailVerificationDescription("catch_all")).toContain("inbox not confirmed");
  });
});

describe("emailVerificationFilterBucket", () => {
  it("maps statuses into filter buckets", () => {
    expect(emailVerificationFilterBucket("verified")).toBe("verified");
    expect(emailVerificationFilterBucket("catch_all")).toBe("risky");
    expect(emailVerificationFilterBucket("not_verified")).toBe("other");
    expect(emailVerificationFilterBucket("bounced")).toBe("other");
  });
});
