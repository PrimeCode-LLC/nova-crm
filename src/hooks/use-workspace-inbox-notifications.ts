"use client";

import * as React from "react";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { buildDemoNotifications, type DemoNotification } from "@/lib/inbox-demo-notifications";
import { buildLeadTaskInboxNotifications } from "@/lib/inbox-lead-task-notifications";
import { buildActivityInboxNotifications } from "@/lib/inbox-activity-notifications";
import {
  mergeNotificationSeed,
  useInboxNotificationOverrides,
} from "@/stores/inbox-notification-overrides-store";
import { useDemoUserNotifications } from "@/stores/demo-user-notifications-store";
import { getFirebaseDb } from "@/lib/firebase/client";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { subscribeUserNotifications } from "@/lib/notifications/subscribe-user-notifications";
import type { UserNotificationDoc } from "@/lib/notifications/user-notification-types";
import {
  persistUserNotificationDismiss,
  persistUserNotificationMarkRead,
  persistUserNotificationsMarkAllRead,
} from "@/lib/notifications/persist-user-notification-client";
import { readUserNotificationSettings } from "@/lib/notifications/alert-preferences";

function toDemoShape(n: UserNotificationDoc): DemoNotification {
  return {
    id: n.id,
    kind: n.kind,
    read: Boolean(n.readAt),
    sender: n.actorId,
    message: n.message,
    target: n.target,
    targetHref: n.targetHref,
    timestamp: n.createdAt,
    durable: true,
    prefKey: n.prefKey,
  };
}

function filterByPrefs(rows: DemoNotification[]): DemoNotification[] {
  const prefs = readUserNotificationSettings();
  return rows.filter((n) => {
    if (n.prefKey === "leadAssigned" && !prefs.leadAssigned) return false;
    return true;
  });
}

/** Demo + durable Firestore + tasks + Activity log rows - same source for Notifications and top bar. */
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
    organizationId,
  } = useWorkspace();
  const readIds = useInboxNotificationOverrides((s) => s.readIds);
  const unreadIds = useInboxNotificationOverrides((s) => s.unreadIds);
  const dismissedIds = useInboxNotificationOverrides((s) => s.dismissedIds);
  const markReadLocal = useInboxNotificationOverrides((s) => s.markRead);
  const markUnreadLocal = useInboxNotificationOverrides((s) => s.markUnread);
  const dismissLocal = useInboxNotificationOverrides((s) => s.dismiss);
  const markAllReadLocal = useInboxNotificationOverrides((s) => s.markAllRead);

  const demoDurable = useDemoUserNotifications((s) => s.items);
  const demoMarkRead = useDemoUserNotifications((s) => s.markRead);
  const demoDismiss = useDemoUserNotifications((s) => s.dismiss);
  const demoMarkAllRead = useDemoUserNotifications((s) => s.markAllRead);

  const [liveDurable, setLiveDurable] = React.useState<UserNotificationDoc[]>([]);
  const [prefsTick, setPrefsTick] = React.useState(0);

  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "nova-crm-settings-notifications-v1") setPrefsTick((t) => t + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Same-tab Settings updates: poll lightly via custom event if Settings dispatches one;
  // also re-read when prefsTick changes and when window gains focus.
  React.useEffect(() => {
    const bump = () => setPrefsTick((t) => t + 1);
    window.addEventListener("focus", bump);
    window.addEventListener("nova-notification-prefs-changed", bump);
    return () => {
      window.removeEventListener("focus", bump);
      window.removeEventListener("nova-notification-prefs-changed", bump);
    };
  }, []);

  React.useEffect(() => {
    if (isDemo || !organizationId || !currentUserId || !isFirebaseWebConfigured()) {
      setLiveDurable([]);
      return;
    }
    let unsub: (() => void) | undefined;
    try {
      const db = getFirebaseDb();
      unsub = subscribeUserNotifications(
        db,
        organizationId,
        currentUserId,
        (rows) => setLiveDurable(rows),
        (err) => console.error("[notifications] subscribe", err),
      );
    } catch (e) {
      console.error("[notifications] subscribe init", e);
    }
    return () => unsub?.();
  }, [isDemo, organizationId, currentUserId]);

  const durableRows = React.useMemo(() => {
    const source = isDemo
      ? demoDurable.filter((n) => n.recipientId === currentUserId && !n.dismissedAt)
      : liveDurable;
    return filterByPrefs(source.map(toDemoShape));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefsTick forces re-filter
  }, [isDemo, demoDurable, liveDurable, currentUserId, prefsTick]);

  const seed = React.useMemo(() => {
    const demo = isDemo ? buildDemoNotifications(leads, users, demoPersonaId) : [];
    const fromTasks = buildLeadTaskInboxNotifications(leadTasks, currentUserId, users);
    const fromActivity = buildActivityInboxNotifications(
      activityRecords,
      currentUserId,
      users,
      getLeadById,
    );
    const derived = filterByPrefs([...demo, ...fromTasks, ...fromActivity]);
    // Durable rows win on id collision.
    const byId = new Map<string, DemoNotification>();
    for (const n of derived) byId.set(n.id, n);
    for (const n of durableRows) byId.set(n.id, n);
    return [...byId.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefsTick forces re-filter
  }, [
    isDemo,
    leads,
    users,
    demoPersonaId,
    leadTasks,
    currentUserId,
    activityRecords,
    getLeadById,
    durableRows,
    prefsTick,
  ]);

  const notifications = React.useMemo(() => {
    return mergeNotificationSeed(seed, { readIds, unreadIds, dismissedIds });
  }, [seed, readIds, unreadIds, dismissedIds]);

  const unreadCount = React.useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const markRead = React.useCallback(
    (id: string) => {
      const row = notifications.find((n) => n.id === id);
      if (row?.durable) {
        if (isDemo) {
          demoMarkRead(id, true);
          return;
        }
        if (isFirebaseWebConfigured()) {
          void persistUserNotificationMarkRead(getFirebaseDb(), id, true).catch((e) =>
            console.error("[notifications] markRead", e),
          );
        }
        return;
      }
      markReadLocal(id);
    },
    [notifications, isDemo, demoMarkRead, markReadLocal],
  );

  const markUnread = React.useCallback(
    (id: string) => {
      const row = notifications.find((n) => n.id === id);
      if (row?.durable) {
        if (isDemo) {
          demoMarkRead(id, false);
          return;
        }
        if (isFirebaseWebConfigured()) {
          void persistUserNotificationMarkRead(getFirebaseDb(), id, false).catch((e) =>
            console.error("[notifications] markUnread", e),
          );
        }
        return;
      }
      markUnreadLocal(id);
    },
    [notifications, isDemo, demoMarkRead, markUnreadLocal],
  );

  const dismiss = React.useCallback(
    (id: string) => {
      const row = notifications.find((n) => n.id === id);
      if (row?.durable) {
        if (isDemo) {
          demoDismiss(id);
          return;
        }
        if (isFirebaseWebConfigured()) {
          void persistUserNotificationDismiss(getFirebaseDb(), id).catch((e) =>
            console.error("[notifications] dismiss", e),
          );
        }
        return;
      }
      dismissLocal(id);
    },
    [notifications, isDemo, demoDismiss, dismissLocal],
  );

  const markAllRead = React.useCallback(
    (ids: string[]) => {
      const durableIds = ids.filter((id) => notifications.find((n) => n.id === id)?.durable);
      const derivedIds = ids.filter((id) => !durableIds.includes(id));
      if (derivedIds.length) markAllReadLocal(derivedIds);
      if (durableIds.length) {
        if (isDemo) {
          demoMarkAllRead(durableIds);
        } else if (isFirebaseWebConfigured()) {
          void persistUserNotificationsMarkAllRead(getFirebaseDb(), durableIds).catch((e) =>
            console.error("[notifications] markAllRead", e),
          );
        }
      }
    },
    [notifications, isDemo, demoMarkAllRead, markAllReadLocal],
  );

  return {
    notifications,
    unreadCount,
    markRead,
    markUnread,
    dismiss,
    markAllRead,
  };
}
