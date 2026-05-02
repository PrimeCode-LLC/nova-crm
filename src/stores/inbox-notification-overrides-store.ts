import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface InboxNotificationOverridesState {
  readIds: string[];
  unreadIds: string[];
  dismissedIds: string[];
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  dismiss: (id: string) => void;
  markAllRead: (ids: string[]) => void;
  reset: () => void;
}

export const useInboxNotificationOverrides = create<InboxNotificationOverridesState>()(
  persist(
    (set, get) => ({
      readIds: [],
      unreadIds: [],
      dismissedIds: [],
      markRead: (id) =>
        set({
          readIds: Array.from(new Set([...get().readIds, id])),
          unreadIds: get().unreadIds.filter((x) => x !== id),
        }),
      markUnread: (id) =>
        set({
          unreadIds: Array.from(new Set([...get().unreadIds, id])),
          readIds: get().readIds.filter((x) => x !== id),
        }),
      dismiss: (id) =>
        set({
          dismissedIds: Array.from(new Set([...get().dismissedIds, id])),
        }),
      markAllRead: (ids) =>
        set({
          readIds: Array.from(new Set([...get().readIds, ...ids])),
          unreadIds: get().unreadIds.filter((x) => !ids.includes(x)),
        }),
      reset: () => set({ readIds: [], unreadIds: [], dismissedIds: [] }),
    }),
    {
      name: "nova-crm-inbox-notification-overrides",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export function mergeNotificationSeed<T extends { id: string; read: boolean }>(
  items: T[],
  overrides: Pick<InboxNotificationOverridesState, "readIds" | "unreadIds" | "dismissedIds">,
): T[] {
  const readSet = new Set(overrides.readIds);
  const unreadSet = new Set(overrides.unreadIds);
  const dismissedSet = new Set(overrides.dismissedIds);
  return items
    .filter((n) => !dismissedSet.has(n.id))
    .map((n) => {
      let read = n.read;
      if (readSet.has(n.id)) read = true;
      if (unreadSet.has(n.id)) read = false;
      return { ...n, read };
    });
}
