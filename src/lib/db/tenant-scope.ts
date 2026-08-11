/**
 * Tenant-scoped Prisma helpers (Phase 2 / P2.2).
 *
 * Postgres RLS reads:
 * - `app.organization_id` — current tenant (SET LOCAL per transaction)
 * - `app.bypass_rls=on` — platform / ETL / reconcile only (still authz in app code)
 *
 * Always use these helpers (or equivalent set_config in the same transaction)
 * for tenant data. Never rely on application WHERE alone.
 */

import type { Prisma } from "@/generated/prisma/client";
import {
  getPrisma,
  PRISMA_TX_MAX_WAIT_MS,
  PRISMA_TX_TIMEOUT_MS,
} from "@/lib/db/prisma";

export type TenantTx = Prisma.TransactionClient;

const TX_OPTIONS = {
  maxWait: PRISMA_TX_MAX_WAIT_MS,
  timeout: PRISMA_TX_TIMEOUT_MS,
} as const;

async function setOrganizationId(tx: TenantTx, organizationId: string): Promise<void> {
  // Third arg true => SET LOCAL (transaction-scoped; safe with pooled connections).
  await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
}

async function setBypassRls(tx: TenantTx, enabled: boolean): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.bypass_rls', ${enabled ? "on" : ""}, true)`;
}

/**
 * Run work as a single tenant. All queries in `fn` see only that org's rows
 * (plus any explicit bypass — do not set bypass here).
 */
export async function withOrganizationScope<T>(
  organizationId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!organizationId.trim()) {
    throw new Error("withOrganizationScope requires a non-empty organizationId");
  }

  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await setOrganizationId(tx, organizationId);
    return fn(tx);
  }, TX_OPTIONS);
}

/**
 * Run work with RLS bypassed for the transaction.
 * Use only for platform-operator / dual-write ETL / reconcile paths that
 * perform their own authorization checks.
 */
export async function withRlsBypass<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await setBypassRls(tx, true);
    return fn(tx);
  }, TX_OPTIONS);
}
