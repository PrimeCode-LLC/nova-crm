"use client";

/**
 * Client data layer — Postgres API polling (replaces Firebase client SDK).
 */

import { getAuth } from "@/lib/db/document-shim/shim-client-auth";
import { getFirestore as getClientFirestore } from "@/lib/db/document-shim/shim-client-firestore";

export function getClientDb() {
  return getClientFirestore();
}

export function getClientAuth() {
  return getAuth();
}
