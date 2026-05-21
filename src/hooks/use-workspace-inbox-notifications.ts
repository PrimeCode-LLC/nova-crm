"use client";

import * as React from "react";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { buildDemoNotifications } from "@/lib/inbox-demo-notifications";
import { buildLeadTaskInboxNotifications } from "@/lib/inbox-lead-task-notifications";
import { buildActivityInboxNotifications } from "@/lib/inbox-activity-notifications";
import {
  mergeNotificationSeed,
  useInboxNotificationOverrides,
} from "@/stores/inbox-notification-overrides-store";

/** Demo + tasks + Activity log rows, merged with persisted read / dismiss — same source for Notifications and top bar. */
export function useWorkspaceInboxNotifications() {
  const {
    leads,
    users,
    isDemo,
    demoPersonaId,
    leadTasks,
    currentUserId,
    activityRecords,
    getLeadById,
  } = useWorkspace();
  const readIds = useInboxNotificationOverrides((s) => s.readIds);
  const unreadIds = useInboxNotificationOverrides((s) => s.unreadIds);
  const dismissedIds = useInboxNotificationOverrides((s) => s.dismissedIds);

  const seed = React.useMemo(() => {
    const demo = isDemo ? buildDemoNotifications(leads, users, demoPersonaId) : [];
    const fromTasks = buildLeadTaskInboxNotifications(leadTasks, currentUserId, users);
    const fromActivity = buildActivityInboxNotifications(activityRecords, currentUserId, users, getLeadById);
    return [...demo, ...fromTasks, ...fromActivity].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [isDemo, leads, users, demoPersonaId, leadTasks, currentUserId, activityRecords, getLeadById]);

  const notifications = React.useMemo(() => {
    return mergeNotificationSeed(seed, { readIds, unreadIds, dismissedIds });
  }, [seed, readIds, unreadIds, dismissedIds]);

  const unreadCount = React.useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  return { notifications, unreadCount };
}
