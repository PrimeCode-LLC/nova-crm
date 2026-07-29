import { describe, expect, it } from "vitest";
import { mapMillionVerifierResult } from "./map-result";
import { buildCreditsUrl, buildVerifyUrl } from "./client";

describe("mapMillionVerifierResult", () => {
  it("maps ok to verified", () => {
    expect(mapMillionVerifierResult("ok")).toEqual({
      emailVerificationStatus: "verified",
      emailVerified: true,
      clearEmailBouncedAt: true,
    });
  });

  it("maps catch_all", () => {
    expect(mapMillionVerifierResult("catch_all")).toEqual({
      emailVerificationStatus: "catch_all",
      emailVerified: false,
      clearEmailBouncedAt: true,
    });
  });

  it("maps invalid and disposable to bounced", () => {
    expect(mapMillionVerifierResult("invalid")).toEqual({
      emailVerificationStatus: "bounced",
      emailVerified: false,
      clearEmailBouncedAt: false,
    });
    expect(mapMillionVerifierResult("disposable")).toEqual({
      emailVerificationStatus: "bounced",
      emailVerified: false,
      clearEmailBouncedAt: false,
    });
  });

  it("maps unknown, error, and empty to not_verified", () => {
    for (const result of ["unknown", "error", "", null, undefined] as const) {
      expect(mapMillionVerifierResult(result)).toEqual({
        emailVerificationStatus: "not_verified",
        emailVerified: false,
        clearEmailBouncedAt: true,
      });
    }
  });

  it("is case-insensitive", () => {
    expect(mapMillionVerifierResult("OK").emailVerificationStatus).toBe("verified");
    expect(mapMillionVerifierResult("Invalid").emailVerificationStatus).toBe("bounced");
  });
});

describe("Million Verifier client URL builders", () => {
  it("builds verify URL with timeout", () => {
    const url = buildVerifyUrl({
      apiKey: "test-key",
      email: "person@example.com",
      timeout: 10,
    });
    expect(url).toContain("https://api.millionverifier.com/api/v3/?");
    expect(url).toContain("api=test-key");
    expect(url).toContain("email=person%40example.com");
    expect(url).toContain("timeout=10");
  });

  it("builds credits URL", () => {
    expect(buildCreditsUrl("abc123")).toBe(
      "https://api.millionverifier.com/api/v3/credits?api=abc123",
    );
  });
});
