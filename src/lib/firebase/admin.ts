/**
 * Server data access — Postgres-backed (replaces Firebase Admin).
 */

import type { App } from "@/lib/db/pg-firestore/shim-app";
import { getAuth, type Auth } from "@/lib/db/pg-firestore/shim-auth";
import {
  getPgFirestore,
  type PgFirestore,
} from "@/lib/db/pg-firestore/shim-firestore";
import { isDatabaseConfigured } from "@/lib/db/prisma";

const app: App = { name: "[DEFAULT]" };

/** Returns null when DATABASE_URL is missing (should not happen in production). */
export function getAdminApp(): App | null {
  return isDatabaseConfigured() ? app : null;
}

export function getAdminAuth(): Auth | null {
  return isDatabaseConfigured() ? getAuth(app) : null;
}

export function getAdminDb(): PgFirestore | null {
  return isDatabaseConfigured() ? getPgFirestore() : null;
}
