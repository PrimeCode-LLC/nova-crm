/**
 * Firebase-free deploy mode (logged ENGINEERING_RULES §1b override).
 *
 * When `FIREBASE_DISABLED=true` (and/or `NEXT_PUBLIC_FIREBASE_DISABLED=true`),
 * Nova runs on Clerk + Postgres + Redis only. Residual Firestore features
 * (chat, email, scrapers intake, etc.) are unavailable until migrated.
 */

export const FIREBASE_DISABLED_FLAG = "firebase_disabled" as const;

/** Server or shared: explicit kill switch. */
export function isFirebaseDisabled(): boolean {
  return (
    process.env.FIREBASE_DISABLED === "true" ||
    process.env.NEXT_PUBLIC_FIREBASE_DISABLED === "true"
  );
}

/**
 * Client-safe: same kill switch via public env (Next inlines NEXT_PUBLIC_*).
 */
export function isFirebaseDisabledClient(): boolean {
  return process.env.NEXT_PUBLIC_FIREBASE_DISABLED === "true";
}
