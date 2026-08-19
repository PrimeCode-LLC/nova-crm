"use client";

/**
 * Client data layer — Postgres API polling (replaces Firebase client SDK).
 */

import { getAuth } from "@/lib/db/pg-firestore/shim-client-auth";
import { getFirestore as getClientFirestore } from "@/lib/db/pg-firestore/shim-client-firestore";

export function getFirebaseDb() {
  return getClientFirestore();
}

export function getFirebaseAuth() {
  return getAuth();
}
