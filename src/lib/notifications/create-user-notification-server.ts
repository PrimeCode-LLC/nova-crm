import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { CreateUserNotificationInput } from "@/lib/notifications/user-notification-types";

function newNotificationId(): string {
  return `un-${crypto.randomUUID()}`;
}

/**
 * Server-side durable notification (Admin SDK). Used by cron / API routes.
 * Skips when recipient === actor. Idempotent when `id` is provided.
 */
export async function createUserNotificationServer(
  input: CreateUserNotificationInput,
): Promise<string | null> {
  const db = getAdminDb();
  if (!db) return null;

  const recipientId = input.recipientId.trim();
  const actorId = input.actorId.trim();
  if (!recipientId || recipientId === actorId) return null;

  const id = input.id?.trim() || newNotificationId();
  const ref = db.collection(COLLECTIONS.userNotifications).doc(id);

  if (input.id) {
    const existing = await ref.get();
    if (existing.exists) return id;
  }

  const createdAt = input.createdAt ?? new Date().toISOString();
  await ref.set({
    organizationId: input.organizationId,
    recipientId,
    kind: input.kind,
    actorId,
    message: input.message,
    target: input.target,
    targetHref: input.targetHref,
    ...(input.entityType ? { entityType: input.entityType } : {}),
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(input.prefKey ? { prefKey: input.prefKey } : {}),
    createdAt,
    readAt: null,
    dismissedAt: null,
    updatedAt: createdAt,
  });
  return id;
}
