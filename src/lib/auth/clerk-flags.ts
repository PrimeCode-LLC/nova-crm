/**
 * Phase 5 feature flag: `auth_clerk_v1` (P5.1).
 *
 * Default off = Firebase Auth + `__session` cookie only.
 * When on (and Clerk keys present), Clerk sign-in runs in parallel;
 * Firebase login remains available until P5.5.
 *
 * Note: `CLERK_SECRET_KEY` is server-only. Client code must not require it —
 * use publishable key + flag for UI (`isClerkAuthV1Enabled`).
 */

export const AUTH_CLERK_V1_FLAG = "auth_clerk_v1" as const;

/** True when env requests the Clerk parallel-auth path. */
export function isClerkAuthV1FlagOn(): boolean {
  return (
    process.env.AUTH_CLERK_V1 === "true" ||
    process.env.NEXT_PUBLIC_AUTH_CLERK_V1 === "true"
  );
}

export function hasClerkPublishableKey(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim());
}

export function hasClerkSecretKey(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY?.trim());
}

/** Both keys present (server routes / proxy). */
export function hasClerkKeys(): boolean {
  return hasClerkPublishableKey() && hasClerkSecretKey();
}

/**
 * Clerk UI / parallel path is active: flag on + publishable key.
 * Safe in Client Components (secret is not exposed to the browser).
 */
export function isClerkAuthV1Enabled(): boolean {
  return isClerkAuthV1FlagOn() && hasClerkPublishableKey();
}

/**
 * Server can verify Clerk sessions: flag on + publishable + secret.
 */
export function isClerkAuthV1ServerEnabled(): boolean {
  return isClerkAuthV1FlagOn() && hasClerkKeys();
}
