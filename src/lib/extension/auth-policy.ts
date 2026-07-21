import crypto from "node:crypto";

export const EXTENSION_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const EXTENSION_FRESH_LOGIN_WINDOW_MS = 5 * 60 * 1000;

export function pkceChallengeForVerifier(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function isFreshInteractiveLogin(
  authTimeMs: number,
  nowMs = Date.now(),
): boolean {
  return (
    Number.isFinite(authTimeMs) &&
    authTimeMs > 0 &&
    authTimeMs <= nowMs + 30_000 &&
    nowMs - authTimeMs <= EXTENSION_FRESH_LOGIN_WINDOW_MS
  );
}

export function extensionSessionExpiresAt(
  authTimeMs: number,
  issuedAtMs = Date.now(),
): number {
  return Math.min(
    authTimeMs + EXTENSION_SESSION_MAX_AGE_MS,
    issuedAtMs + EXTENSION_SESSION_MAX_AGE_MS,
  );
}
