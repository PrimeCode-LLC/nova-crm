/**
 * Server-side Prisma client (Phase 2 / P2.1).
 *
 * Local: `DATABASE_URL=postgres://nova:nova_dev_password@localhost:5432/nova_crm`
 * (Compose Postgres 16 — see docs/ENVIRONMENTS.md).
 * Staging/prod: separate managed Postgres URLs — never share with local.
 *
 * Prisma 7 requires a driver adapter (`@prisma/adapter-pg`).
 * Import only from server code (API routes, server actions, workers) — not client components.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export function getDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url || null;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(getDatabaseUrl());
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Local: docker compose up -d postgres && set DATABASE_URL in .env.local (see .env.example).",
    );
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
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

/** Close the shared client (tests / graceful shutdown). */
export async function disconnectPrisma(): Promise<void> {
  const client = globalForPrisma.prisma;
  if (!client) return;
  globalForPrisma.prisma = undefined;
  await client.$disconnect();
}
