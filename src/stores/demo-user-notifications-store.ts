import { create } from "zustand";
import type { CreateUserNotificationInput } from "@/lib/notifications/user-notification-types";
import type { UserNotificationDoc } from "@/lib/notifications/user-notification-types";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `un-${crypto.randomUUID()}`;
  }
  return `un-demo-${Date.now()}`;
}

type DemoUserNotificationsState = {
  items: UserNotificationDoc[];
  add: (input: CreateUserNotificationInput) => void;
  markRead: (id: string, read: boolean) => void;
  dismiss: (id: string) => void;
  markAllRead: (ids: string[]) => void;
  reset: () => void;
};

export const useDemoUserNotifications = create<DemoUserNotificationsState>((set, get) => ({
  items: [],
  add: (input) => {
    const id = input.id?.trim() || newId();
    if (get().items.some((n) => n.id === id)) return;
    const doc: UserNotificationDoc = {
      id,
      organizationId: input.organizationId,
      recipientId: input.recipientId,
      kind: input.kind,
      actorId: input.actorId,
      message: input.message,
      target: input.target,
      targetHref: input.targetHref,
      entityType: input.entityType,
      entityId: input.entityId,
      prefKey: input.prefKey,
      createdAt: input.createdAt ?? new Date().toISOString(),
      readAt: null,
      dismissedAt: null,
    };
    set({ items: [doc, ...get().items].slice(0, 80) });
  },
  markRead: (id, read) => {
    const row = get().items.find((n) => n.id === id);
    if (!row) return;
    const isRead = Boolean(row.readAt);
    if (read === isRead) return;
    set({
      items: get().items.map((n) =>
        n.id === id ? { ...n, readAt: read ? new Date().toISOString() : null } : n,
      ),
    });
  },
  dismiss: (id) => {
    const row = get().items.find((n) => n.id === id);
    if (!row || row.dismissedAt) return;
    set({
      items: get().items.map((n) =>
        n.id === id ? { ...n, dismissedAt: new Date().toISOString() } : n,
      ),
    });
  },
  markAllRead: (ids) => {
    const setIds = new Set(ids);
    const needsUpdate = get().items.some((n) => setIds.has(n.id) && !n.readAt);
    if (!needsUpdate) return;
    const iso = new Date().toISOString();
    set({
      items: get().items.map((n) => (setIds.has(n.id) ? { ...n, readAt: iso } : n)),
    });
  },
  reset: () => set({ items: [] }),
}));
