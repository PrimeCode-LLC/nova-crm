import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { isFirebaseDisabled } from "@/lib/firebase/runtime";

let app: App | undefined;

function initAdminApp(): App | null {
  if (isFirebaseDisabled()) return null;
  if (app) return app;
  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n",
  );

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  if (!getApps().length) {
    app = initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
  } else {
    app = getApps()[0]!;
  }
  return app;
}

/** Returns null when service-account env is missing (local UI-only dev). */
export function getAdminApp(): App | null {
  return initAdminApp();
}

export function getAdminAuth(): Auth | null {
  const a = initAdminApp();
  return a ? getAuth(a) : null;
}

export function getAdminDb(): Firestore | null {
  const a = initAdminApp();
  return a ? getFirestore(a) : null;
}
