/**
 * Server-side Prisma client (Phase 2 / P2.1).
 *
 * Local app: `DATABASE_URL=postgres://nova_app:nova_dev_password@localhost:5432/nova_crm`
 * (Compose Postgres 16 — `nova_app` is non-superuser so FORCE RLS applies).
 * Migrations: `MIGRATE_DATABASE_URL` as Compose superuser `nova` (see docs/ENVIRONMENTS.md).
 * Staging/prod: separate managed Postgres URLs — never share with local.
 *
 * Prisma 7 requires a driver adapter (`@prisma/adapter-pg`).
 * Import only from server code (API routes, server actions, workers) — not client components.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "@/generated/prisma/client";

export function getDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url || null;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(getDatabaseUrl());
}

/** Default interactive-transaction wait / run budgets (ms). */
export const PRISMA_TX_MAX_WAIT_MS = 10_000;
export const PRISMA_TX_TIMEOUT_MS = 20_000;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgPool: Pool | undefined;
};

function createPgPool(connectionString: string): Pool {
  const max = Math.max(
    2,
    Math.min(20, Number.parseInt(process.env.PG_POOL_MAX ?? "10", 10) || 10),
  );
  const pool = new Pool({
    connectionString,
    max,
    // Fail fast under saturation instead of hanging until interactive tx gives up.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  });
  pool.on("error", (err) => {
    console.error("[pg-pool] idle client error", err instanceof Error ? err.message : err);
  });
  return pool;
}

function createPrismaClient(): PrismaClient {
  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Local: docker compose up -d postgres && set DATABASE_URL in .env.local (see .env.example).",
    );
  }

  const pool = createPgPool(connectionString);
  globalForPrisma.pgPool = pool;
  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    transactionOptions: {
      maxWait: PRISMA_TX_MAX_WAIT_MS,
      timeout: PRISMA_TX_TIMEOUT_MS,
    },
  });
}

/**
 * Shared Prisma client. Lazily created; reused across hot reloads in development.
 * Throws if `DATABASE_URL` is unset — callers that must soft-fail should check
 * `isDatabaseConfigured()` first.
 */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

/** Close the shared client + pool (tests / graceful shutdown). */
export async function disconnectPrisma(): Promise<void> {
  const client = globalForPrisma.prisma;
  const pool = globalForPrisma.pgPool;
  globalForPrisma.prisma = undefined;
  globalForPrisma.pgPool = undefined;
  if (client) {
    await client.$disconnect();
  }
  if (pool) {
    await pool.end().catch(() => {
      /* ignore */
    });
  }
}
