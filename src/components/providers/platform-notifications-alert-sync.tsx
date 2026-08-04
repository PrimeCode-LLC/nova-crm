"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { useWorkspaceInboxNotifications } from "@/components/providers/workspace-inbox-notifications-provider";
import { playAlertSound } from "@/lib/notifications/play-alert-sound";

/**
 * Detects new unread CRM notifications (tasks, activity, demo alerts) and plays a chime.
 * Firestore-backed notification feeds can plug into the same hook later.
 */
export function PlatformNotificationsAlertSync() {
  const pathname = usePathname();
  const { notifications } = useWorkspaceInboxNotifications();
  const bootstrappedRef = React.useRef(false);
  const seenUnreadIdsRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    bootstrappedRef.current = false;
    seenUnreadIdsRef.current.clear();
  }, []);

  React.useEffect(() => {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    const unreadSet = new Set(unreadIds);

    if (!bootstrappedRef.current) {
      seenUnreadIdsRef.current = unreadSet;
      bootstrappedRef.current = true;
      return;
    }

    const fresh: string[] = [];
    for (const id of unreadSet) {
      if (!seenUnreadIdsRef.current.has(id)) fresh.push(id);
    }
    seenUnreadIdsRef.current = unreadSet;

    if (fresh.length === 0) return;

    const onNotifications =
      pathname === "/notifications" || pathname.startsWith("/notifications/");
    if (!onNotifications) {
      playAlertSound("notification");
    }

    if (!onNotifications && document.visibilityState !== "hidden") {
      const sample = notifications.find((n) => n.id === fresh[0]);
      toast.message(fresh.length === 1 ? "New notification" : `${fresh.length} new notifications`, {
        description: sample?.message?.slice(0, 120) ?? "Open Notifications to review.",
        duration: 6000,
        action: {
          label: "View",
          onClick: () => {
            window.location.href = "/notifications";
          },
        },
      });
    }
  }, [notifications, pathname]);

  return null;
}
