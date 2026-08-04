import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stripUndefined } from "@/lib/firestore/strip-undefined";
import type {
  CreateUserNotificationInput,
  UserNotificationDoc,
} from "@/lib/notifications/user-notification-types";

function newNotificationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `un-${crypto.randomUUID()}`;
  }
  return `un-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function userNotificationRef(db: Firestore, id: string) {
  return doc(db, COLLECTIONS.userNotifications, id);
}

/** Creates a notification. Skips when recipient === actor. Idempotent when `id` is provided. */
export async function persistUserNotificationCreate(
  db: Firestore,
  input: CreateUserNotificationInput,
): Promise<string | null> {
  const recipientId = input.recipientId.trim();
  const actorId = input.actorId.trim();
  if (!recipientId || recipientId === actorId) return null;

  const id = input.id?.trim() || newNotificationId();
  const ref = userNotificationRef(db, id);

  if (input.id) {
    const existing = await getDoc(ref);
    if (existing.exists()) return id;
  }

  const createdAt = input.createdAt ?? new Date().toISOString();
  const data = stripUndefined({
    organizationId: input.organizationId,
    recipientId,
    kind: input.kind,
    actorId,
    message: input.message,
    target: input.target,
    targetHref: input.targetHref,
    entityType: input.entityType,
    entityId: input.entityId,
    prefKey: input.prefKey,
    createdAt,
    readAt: null,
    dismissedAt: null,
  });

  await setDoc(ref, data);
  return id;
}

export async function persistUserNotificationsCreateMany(
  db: Firestore,
  inputs: CreateUserNotificationInput[],
): Promise<void> {
  const eligible = inputs.filter((i) => {
    const r = i.recipientId.trim();
    return r && r !== i.actorId.trim();
  });
  if (!eligible.length) return;

  // Prefer create-if-missing when ids are deterministic (follow-up due alerts / task assigns).
  const withIds = eligible.filter((i) => i.id?.trim());
  const withoutIds = eligible.filter((i) => !i.id?.trim());

  const EXIST_CHUNK = 40;
  for (let i = 0; i < withIds.length; i += EXIST_CHUNK) {
    const slice = withIds.slice(i, i + EXIST_CHUNK);
    const snaps = await Promise.all(
      slice.map((input) => getDoc(userNotificationRef(db, input.id!.trim()))),
    );
    const missing = slice.filter((_, idx) => !snaps[idx]?.exists());
    if (!missing.length) continue;
    const batch = writeBatch(db);
    for (const input of missing) {
      const id = input.id!.trim();
      const createdAt = input.createdAt ?? new Date().toISOString();
      batch.set(
        userNotificationRef(db, id),
        stripUndefined({
          organizationId: input.organizationId,
          recipientId: input.recipientId.trim(),
          kind: input.kind,
          actorId: input.actorId.trim(),
          message: input.message,
          target: input.target,
          targetHref: input.targetHref,
          entityType: input.entityType,
          entityId: input.entityId,
          prefKey: input.prefKey,
          createdAt,
          readAt: null,
          dismissedAt: null,
        }),
      );
    }
    await batch.commit();
  }

  if (!withoutIds.length) return;

  const CHUNK = 400;
  for (let i = 0; i < withoutIds.length; i += CHUNK) {
    const slice = withoutIds.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const input of slice) {
      const id = newNotificationId();
      const createdAt = input.createdAt ?? new Date().toISOString();
      batch.set(
        userNotificationRef(db, id),
        stripUndefined({
          organizationId: input.organizationId,
          recipientId: input.recipientId.trim(),
          kind: input.kind,
          actorId: input.actorId.trim(),
          message: input.message,
          target: input.target,
          targetHref: input.targetHref,
          entityType: input.entityType,
          entityId: input.entityId,
          prefKey: input.prefKey,
          createdAt,
          readAt: null,
          dismissedAt: null,
        }),
      );
    }
    await batch.commit();
  }
}

export async function persistUserNotificationMarkRead(
  db: Firestore,
  id: string,
  read: boolean,
): Promise<void> {
  await updateDoc(userNotificationRef(db, id), {
    readAt: read ? new Date().toISOString() : null,
  });
}

export async function persistUserNotificationDismiss(
  db: Firestore,
  id: string,
): Promise<void> {
  await updateDoc(userNotificationRef(db, id), {
    dismissedAt: new Date().toISOString(),
  });
}

export async function persistUserNotificationsMarkAllRead(
  db: Firestore,
  ids: string[],
): Promise<void> {
  if (!ids.length) return;
  const iso = new Date().toISOString();
  const CHUNK = 400;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const id of ids.slice(i, i + CHUNK)) {
      batch.update(userNotificationRef(db, id), { readAt: iso });
    }
    await batch.commit();
  }
}

export function mapUserNotificationDoc(
  id: string,
  raw: Record<string, unknown>,
): UserNotificationDoc | null {
  const recipientId = typeof raw.recipientId === "string" ? raw.recipientId : "";
  const organizationId = typeof raw.organizationId === "string" ? raw.organizationId : "";
  const kind = typeof raw.kind === "string" ? raw.kind : "";
  const actorId = typeof raw.actorId === "string" ? raw.actorId : "";
  const message = typeof raw.message === "string" ? raw.message : "";
  const target = typeof raw.target === "string" ? raw.target : "";
  const targetHref = typeof raw.targetHref === "string" ? raw.targetHref : "";
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : "";
  if (!recipientId || !organizationId || !kind || !message || !createdAt) return null;

  return {
    id,
    organizationId,
    recipientId,
    kind: kind as UserNotificationDoc["kind"],
    actorId,
    message,
    target,
    targetHref: targetHref || "/notifications",
    entityType: raw.entityType as UserNotificationDoc["entityType"] | undefined,
    entityId: typeof raw.entityId === "string" ? raw.entityId : undefined,
    prefKey: raw.prefKey === "leadAssigned" ? "leadAssigned" : undefined,
    createdAt,
    readAt: typeof raw.readAt === "string" ? raw.readAt : raw.readAt === null ? null : undefined,
    dismissedAt:
      typeof raw.dismissedAt === "string"
        ? raw.dismissedAt
        : raw.dismissedAt === null
          ? null
          : undefined,
  };
}
