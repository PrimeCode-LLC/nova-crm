import { isFirebaseDisabled } from "@/lib/firebase/runtime";

/** Public web config (safe on the client). */
export function getFirebaseWebConfig() {
  if (isFirebaseDisabled()) return null;

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  const measurementId = process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID;

  if (!apiKey || !authDomain || !projectId || !messagingSenderId || !appId) {
    return null;
  }

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket: storageBucket ?? `${projectId}.appspot.com`,
    messagingSenderId,
    appId,
    measurementId: measurementId || undefined,
  } as const;
}

export function isFirebaseWebConfigured(): boolean {
  return getFirebaseWebConfig() !== null;
}
