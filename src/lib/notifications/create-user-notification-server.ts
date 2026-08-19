import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
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
  const { publishRealtimeEvent } = await import("@/lib/realtime/sse");
  await publishRealtimeEvent(input.organizationId, "notifications", recipientId, {
    id,
    kind: input.kind,
  });
  return id;
}

/** Batch create with parallel existence checks for deterministic ids. */
export async function createUserNotificationsServer(
  inputs: CreateUserNotificationInput[],
): Promise<void> {
  const db = getAdminDb();
  if (!db || !inputs.length) return;

  const eligible = inputs.filter((i) => {
    const r = i.recipientId.trim();
    return r && r !== i.actorId.trim();
  });
  if (!eligible.length) return;

  const withIds = eligible.filter((i) => i.id?.trim());
  const withoutIds = eligible.filter((i) => !i.id?.trim());

  const EXIST_CHUNK = 40;
  for (let i = 0; i < withIds.length; i += EXIST_CHUNK) {
    const slice = withIds.slice(i, i + EXIST_CHUNK);
    const snaps = await db.getAll(
      ...slice.map((input) => db.collection(COLLECTIONS.userNotifications).doc(input.id!.trim())),
    );
    const missing = slice.filter((_, idx) => !snaps[idx]?.exists);
    if (!missing.length) continue;
    const batch = db.batch();
    const now = new Date().toISOString();
    for (const input of missing) {
      const id = input.id!.trim();
      const createdAt = input.createdAt ?? now;
      batch.set(db.collection(COLLECTIONS.userNotifications).doc(id), {
        organizationId: input.organizationId,
        recipientId: input.recipientId.trim(),
        kind: input.kind,
        actorId: input.actorId.trim(),
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
    }
    await batch.commit();
  }

  const WRITE_CHUNK = 400;
  for (let i = 0; i < withoutIds.length; i += WRITE_CHUNK) {
    const slice = withoutIds.slice(i, i + WRITE_CHUNK);
    const batch = db.batch();
    const now = new Date().toISOString();
    for (const input of slice) {
      const id = newNotificationId();
      const createdAt = input.createdAt ?? now;
      batch.set(db.collection(COLLECTIONS.userNotifications).doc(id), {
        organizationId: input.organizationId,
        recipientId: input.recipientId.trim(),
        kind: input.kind,
        actorId: input.actorId.trim(),
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
    }
    await batch.commit();
  }
}
