"use client";

import * as React from "react";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { buildDemoNotifications } from "@/lib/inbox-demo-notifications";
import { buildLeadTaskInboxNotifications } from "@/lib/inbox-lead-task-notifications";
import {
  mergeNotificationSeed,
  useInboxNotificationOverrides,
} from "@/stores/inbox-notification-overrides-store";
import { useZustandPersistHydrated } from "@/hooks/use-zustand-persist-hydrated";

/** Demo seed + assigned-task rows, merged with persisted read / dismiss — same source for Inbox and top bar. */
export function useWorkspaceInboxNotifications() {
  const { leads, users, isDemo, demoPersonaId, leadTasks, currentUserId } = useWorkspace();
  const inboxHydrated = useZustandPersistHydrated(useInboxNotificationOverrides);
  const readIds = useInboxNotificationOverrides((s) => s.readIds);
  const unreadIds = useInboxNotificationOverrides((s) => s.unreadIds);
  const dismissedIds = useInboxNotificationOverrides((s) => s.dismissedIds);

  const seed = React.useMemo(() => {
    const demo = isDemo ? buildDemoNotifications(leads, users, demoPersonaId) : [];
    const fromTasks = buildLeadTaskInboxNotifications(leadTasks, currentUserId, users);
    return [...demo, ...fromTasks].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [isDemo, leads, users, demoPersonaId, leadTasks, currentUserId]);

  const notifications = React.useMemo(() => {
    if (!inboxHydrated) return [];
    return mergeNotificationSeed(seed, { readIds, unreadIds, dismissedIds });
  }, [seed, readIds, unreadIds, dismissedIds, inboxHydrated]);

  return { notifications, inboxHydrated };
}
