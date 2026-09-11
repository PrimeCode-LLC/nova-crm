/**
 * Append-only email lifecycle events (deliverability + conversion analytics).
 */

import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import { isDatabaseConfigured } from "@/lib/db/prisma";

export type EmailEventType =
  | "scheduled"
  | "sent"
  | "failed"
  | "cancelled"
  | "bounced"
  | "opened"
  | "clicked"
  | "replied"
  | "unsubscribed";

export type RecordEmailEventInput = {
  organizationId: string;
  type: EmailEventType;
  occurredAt?: Date;
  scheduledEmailId?: string;
  followupId?: string;
  leadId?: string;
  mailboxId?: string;
  messageId?: string;
  recipient?: string;
  meta?: Record<string, unknown>;
};

/** Fire-and-forget friendly: never throws to callers that `void` it. */
export async function recordEmailEvent(
  input: RecordEmailEventInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isDatabaseConfigured()) return { ok: false, error: "Database not configured" };
  const organizationId = input.organizationId.trim();
  if (!organizationId) return { ok: false, error: "organizationId required" };

  try {
    const id = randomUUID();
    await withOrganizationScope(organizationId, async (tx) => {
      await tx.emailEvent.create({
        data: {
          id,
          organizationId,
          occurredAt: input.occurredAt ?? new Date(),
          type: input.type,
          scheduledEmailId: input.scheduledEmailId ?? null,
          followupId: input.followupId ?? null,
          leadId: input.leadId ?? null,
          mailboxId: input.mailboxId ?? null,
          messageId: input.messageId ?? null,
          recipient: input.recipient?.trim().toLowerCase() || null,
          meta: (input.meta ?? {}) as Prisma.InputJsonValue,
        },
      });
    });
    return { ok: true, id };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn("[email-events] record failed", { type: input.type, error });
    return { ok: false, error };
  }
}
