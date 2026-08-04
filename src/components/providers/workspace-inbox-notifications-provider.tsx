"use client";

import * as React from "react";
import {
  useWorkspaceInboxNotificationsState,
  type WorkspaceInboxNotificationsValue,
} from "@/hooks/use-workspace-inbox-notifications";

const WorkspaceInboxNotificationsContext =
  React.createContext<WorkspaceInboxNotificationsValue | null>(null);

/**
 * Single subscriber for durable userNotifications + inbox merge.
 * Topbar, sidebar, Notifications page, and alert sync must share this —
 * mounting the hook in each place opens duplicate Firestore listeners.
 */
export function WorkspaceInboxNotificationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = useWorkspaceInboxNotificationsState();
  return (
    <WorkspaceInboxNotificationsContext.Provider value={value}>
      {children}
    </WorkspaceInboxNotificationsContext.Provider>
  );
}

export function useWorkspaceInboxNotifications(): WorkspaceInboxNotificationsValue {
  const ctx = React.useContext(WorkspaceInboxNotificationsContext);
  if (!ctx) {
    throw new Error(
      "useWorkspaceInboxNotifications must be used within WorkspaceInboxNotificationsProvider",
    );
  }
  return ctx;
}
