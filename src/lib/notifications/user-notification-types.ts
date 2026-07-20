import type { NotificationKind } from "@/lib/inbox-demo-notifications";

/** Settings key that can suppress a durable notification on the recipient side. */
export type NotificationPrefKey = "leadAssigned";

export type UserNotificationEntityType =
  | "lead"
  | "prospect"
  | "strategy"
  | "task"
  | "followup"
  | "chat"
  | "channel"
  | "deal";

/** Firestore document in `userNotifications`. */
export interface UserNotificationDoc {
  id: string;
  organizationId: string;
  recipientId: string;
  kind: NotificationKind;
  actorId: string;
  message: string;
  target: string;
  targetHref: string;
  entityType?: UserNotificationEntityType;
  entityId?: string;
  /** When set, recipient Settings can hide this row. */
  prefKey?: NotificationPrefKey;
  createdAt: string;
  readAt?: string | null;
  dismissedAt?: string | null;
}

export type CreateUserNotificationInput = {
  organizationId: string;
  recipientId: string;
  actorId: string;
  kind: NotificationKind;
  message: string;
  target: string;
  targetHref: string;
  entityType?: UserNotificationEntityType;
  entityId?: string;
  prefKey?: NotificationPrefKey;
  /** Deterministic id for idempotent writes (e.g. follow-up due once per day). */
  id?: string;
  createdAt?: string;
};
