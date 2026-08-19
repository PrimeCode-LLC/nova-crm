/**
 * Clerk auth (P7 — sole auth provider; flag defaults on unless explicitly false).
 */

export const AUTH_CLERK_V1_FLAG = "auth_clerk_v1" as const;

export function isClerkAuthV1FlagOn(): boolean {
  return (
    process.env.AUTH_CLERK_V1 !== "false" &&
    process.env.NEXT_PUBLIC_AUTH_CLERK_V1 !== "false"
  );
}

export function hasClerkPublishableKey(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim());
}

export function hasClerkSecretKey(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY?.trim());
}

export function hasClerkKeys(): boolean {
  return hasClerkPublishableKey() && hasClerkSecretKey();
}

export function isClerkAuthV1Enabled(): boolean {
  return isClerkAuthV1FlagOn() && hasClerkPublishableKey();
}

export function isClerkAuthV1ServerEnabled(): boolean {
  return isClerkAuthV1FlagOn() && hasClerkKeys();
}
