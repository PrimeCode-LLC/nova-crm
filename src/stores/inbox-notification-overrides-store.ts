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
      markRead: (id) => {
        const { readIds, unreadIds } = get();
        if (readIds.includes(id) && !unreadIds.includes(id)) return;
        set({
          readIds: readIds.includes(id) ? readIds : [...readIds, id],
          unreadIds: unreadIds.filter((x) => x !== id),
        });
      },
      markUnread: (id) => {
        const { readIds, unreadIds } = get();
        if (unreadIds.includes(id) && !readIds.includes(id)) return;
        set({
          unreadIds: unreadIds.includes(id) ? unreadIds : [...unreadIds, id],
          readIds: readIds.filter((x) => x !== id),
        });
      },
      dismiss: (id) => {
        const { dismissedIds } = get();
        if (dismissedIds.includes(id)) return;
        set({
          dismissedIds: [...dismissedIds, id],
        });
      },
      markAllRead: (ids) => {
        const { readIds, unreadIds } = get();
        const nextRead = Array.from(new Set([...readIds, ...ids]));
        const nextUnread = unreadIds.filter((x) => !ids.includes(x));
        if (
          nextRead.length === readIds.length &&
          nextRead.every((id) => readIds.includes(id)) &&
          nextUnread.length === unreadIds.length
        ) {
          return;
        }
        set({ readIds: nextRead, unreadIds: nextUnread });
      },
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
