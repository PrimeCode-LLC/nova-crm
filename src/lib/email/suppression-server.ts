/**
 * Org-wide email suppression list (unsubscribe / hard bounce / complaint / manual).
 */

import { randomUUID } from "node:crypto";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import { recordEmailEvent } from "@/lib/email/email-events-server";

export type SuppressionReason =
  | "unsubscribe"
  | "hard_bounce"
  | "complaint"
  | "manual";

export function normalizeSuppressionEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function isSuppressed(input: {
  organizationId: string;
  email: string;
}): Promise<boolean> {
  const emailNormalized = normalizeSuppressionEmail(input.email);
  if (!emailNormalized || !emailNormalized.includes("@")) return false;
  return withOrganizationScope(input.organizationId, async (tx) => {
    const row = await tx.emailSuppression.findUnique({
      where: {
        organizationId_emailNormalized: {
          organizationId: input.organizationId,
          emailNormalized,
        },
      },
      select: { id: true },
    });
    return Boolean(row);
  });
}

export async function addSuppression(input: {
  organizationId: string;
  email: string;
  reason: SuppressionReason;
  source?: string;
  leadId?: string;
  createdBy?: string;
}): Promise<{ ok: true; id: string; created: boolean } | { error: string }> {
  const emailNormalized = normalizeSuppressionEmail(input.email);
  if (!emailNormalized || !emailNormalized.includes("@")) {
    return { error: "Invalid email address." };
  }
  try {
    const result = await withOrganizationScope(input.organizationId, async (tx) => {
      const existing = await tx.emailSuppression.findUnique({
        where: {
          organizationId_emailNormalized: {
            organizationId: input.organizationId,
            emailNormalized,
          },
        },
      });
      if (existing) {
        return { id: existing.id, created: false };
      }
      const id = randomUUID();
      await tx.emailSuppression.create({
        data: {
          id,
          organizationId: input.organizationId,
          emailNormalized,
          reason: input.reason,
          source: input.source ?? "system",
          leadId: input.leadId ?? null,
          createdBy: input.createdBy ?? null,
        },
      });
      return { id, created: true };
    });

    if (result.created) {
      void recordEmailEvent({
        organizationId: input.organizationId,
        type: "unsubscribed",
        leadId: input.leadId,
        recipient: emailNormalized,
        meta: { reason: input.reason, source: input.source ?? "system" },
      });
    }
    return { ok: true, id: result.id, created: result.created };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function removeSuppression(input: {
  organizationId: string;
  email: string;
}): Promise<{ ok: true; removed: boolean } | { error: string }> {
  const emailNormalized = normalizeSuppressionEmail(input.email);
  if (!emailNormalized) return { error: "Invalid email address." };
  try {
    const removed = await withOrganizationScope(input.organizationId, async (tx) => {
      const result = await tx.emailSuppression.deleteMany({
        where: {
          organizationId: input.organizationId,
          emailNormalized,
        },
      });
      return result.count > 0;
    });
    return { ok: true, removed };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listSuppressions(input: {
  organizationId: string;
  limit?: number;
}): Promise<
  Array<{
    id: string;
    emailNormalized: string;
    reason: string;
    source: string;
    leadId?: string;
    createdBy?: string;
    createdAt: string;
  }>
> {
  const limit = Math.min(500, Math.max(1, input.limit ?? 100));
  return withOrganizationScope(input.organizationId, async (tx) => {
    const rows = await tx.emailSuppression.findMany({
      where: { organizationId: input.organizationId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      emailNormalized: r.emailNormalized,
      reason: r.reason,
      source: r.source,
      leadId: r.leadId ?? undefined,
      createdBy: r.createdBy ?? undefined,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}
