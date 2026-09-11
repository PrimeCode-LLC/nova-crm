import { getClientDb } from "@/lib/db/document-access/client";
import {
  persistUserNotificationCreate,
  persistUserNotificationsCreateMany,
} from "@/lib/notifications/persist-user-notification-client";
import type { CreateUserNotificationInput } from "@/lib/notifications/user-notification-types";
import { useDemoUserNotifications } from "@/stores/demo-user-notifications-store";

export type NotifyContext = {
  organizationId: string | undefined;
  isDemo: boolean;
};

/**
 * Writes a durable in-app notification for a recipient.
 * No-ops when recipient === actor. Demo mode uses an in-memory store.
 */
export async function createUserNotification(
  ctx: NotifyContext,
  input: Omit<CreateUserNotificationInput, "organizationId"> & {
    organizationId?: string;
  },
): Promise<void> {
  const recipientId = input.recipientId.trim();
  const actorId = input.actorId.trim();
  if (!recipientId || recipientId === actorId) return;

  const orgId = (input.organizationId ?? ctx.organizationId)?.trim();
  const payload: CreateUserNotificationInput = {
    ...input,
    organizationId: orgId || "demo",
    recipientId,
    actorId,
  };

  if (ctx.isDemo || !orgId) {
    useDemoUserNotifications.getState().add(payload);
    return;
  }

  try {
    await persistUserNotificationCreate(getClientDb(), payload);
  } catch (e) {
    console.error("[notifications] create failed", e);
  }
}

export async function createUserNotifications(
  ctx: NotifyContext,
  inputs: Array<Omit<CreateUserNotificationInput, "organizationId"> & { organizationId?: string }>,
): Promise<void> {
  if (!inputs.length) return;

  if (ctx.isDemo || !ctx.organizationId) {
    const store = useDemoUserNotifications.getState();
    for (const input of inputs) {
      const recipientId = input.recipientId.trim();
      const actorId = input.actorId.trim();
      if (!recipientId || recipientId === actorId) continue;
      store.add({
        ...input,
        organizationId: "demo",
        recipientId,
        actorId,
      });
    }
    return;
  }

  const orgId = ctx.organizationId;
  const prepared: CreateUserNotificationInput[] = inputs
    .map((input) => ({
      ...input,
      organizationId: input.organizationId?.trim() || orgId,
      recipientId: input.recipientId.trim(),
      actorId: input.actorId.trim(),
    }))
    .filter((i) => i.recipientId && i.recipientId !== i.actorId);

  if (!prepared.length) return;
  try {
    await persistUserNotificationsCreateMany(getClientDb(), prepared);
  } catch (e) {
    console.error("[notifications] batch create failed", e);
  }
}

/** Display label helper for notification copy. */
export function actorLabel(
  users: { id: string; displayName?: string; email?: string }[],
  actorId: string,
  fallback = "Teammate",
): string {
  const u = users.find((x) => x.id === actorId);
  return u?.displayName?.trim() || u?.email?.split("@")[0]?.trim() || fallback;
}
