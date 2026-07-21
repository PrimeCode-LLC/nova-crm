import { describe, expect, it } from "vitest";
import {
  EXTENSION_SESSION_MAX_AGE_MS,
  extensionSessionExpiresAt,
  isFreshInteractiveLogin,
  pkceChallengeForVerifier,
} from "@/lib/extension/auth-policy";

describe("extension authentication policy", () => {
  it("accepts only a recent interactive authentication", () => {
    const now = Date.UTC(2026, 6, 21, 8);
    expect(isFreshInteractiveLogin(now - 60_000, now)).toBe(true);
    expect(isFreshInteractiveLogin(now - 6 * 60_000, now)).toBe(false);
    expect(isFreshInteractiveLogin(0, now)).toBe(false);
  });

  it("never extends a session beyond 24 hours from auth_time", () => {
    const authTime = Date.UTC(2026, 6, 21, 8);
    const issuedLater = authTime + 4 * 60 * 60 * 1000;
    expect(extensionSessionExpiresAt(authTime, issuedLater)).toBe(
      authTime + EXTENSION_SESSION_MAX_AGE_MS,
    );
  });

  it("computes the RFC 7636 S256 challenge", () => {
    expect(
      pkceChallengeForVerifier(
        "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      ),
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
