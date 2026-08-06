"use client";

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getFirebaseWebConfig } from "./config";

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let storage: FirebaseStorage | undefined;

export function getFirebaseApp(): FirebaseApp {
  if (typeof window === "undefined") {
    throw new Error("Firebase client SDK must only run in the browser.");
  }
  const cfg = getFirebaseWebConfig();
  if (!cfg) {
    throw new Error(
      "Firebase is not configured. Set NEXT_PUBLIC_FIREBASE_* in .env.local.",
    );
  }
  if (!app) {
    app = getApps().length ? getApps()[0]! : initializeApp(cfg);
  }
  return app;
}

export function getFirebaseAuth(): Auth {
  if (!auth) {
    auth = getAuth(getFirebaseApp());
  }
  return auth;
}

/**
 * Prefer persistent multi-tab cache so reconnects resume via tokens (only
 * changed docs billed) and sibling tabs share one persistence lease.
 * Single-tab persistence breaks when a second tab / HMR instance is open.
 * Fall back to memory cache when IndexedDB is unavailable.
 */
export function getFirebaseDb(): Firestore {
  if (!db) {
    const appInstance = getFirebaseApp();
    try {
      db = initializeFirestore(appInstance, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
    } catch {
      try {
        // Already initialized (HMR) or persistence unavailable — reuse or memory.
        db = getFirestore(appInstance);
      } catch {
        db = initializeFirestore(appInstance, {
          localCache: memoryLocalCache(),
        });
      }
    }
  }
  return db;
}

export function getFirebaseStorage(): FirebaseStorage {
  if (!storage) {
    storage = getStorage(getFirebaseApp());
  }
  return storage;
}
