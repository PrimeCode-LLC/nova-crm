"use client";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { WorkspaceNotificationsView } from "@/components/inbox/workspace-notifications-view";

export default function NotificationsPage() {
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Mentions, assignments, and alerts across your pipeline."
      />
      <PageBody className="flex min-h-0 flex-1 flex-col space-y-0 overflow-hidden p-0">
        <WorkspaceNotificationsView />
      </PageBody>
    </>
  );
}
