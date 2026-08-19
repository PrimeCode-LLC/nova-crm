/** Firebase kill switch removed — Firebase is not used. */

export const FIREBASE_DISABLED_FLAG = "firebase_removed" as const;

export function isFirebaseDisabled(): boolean {
  return true;
}

export function isFirebaseDisabledClient(): boolean {
  return true;
}
