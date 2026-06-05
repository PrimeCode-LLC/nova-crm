"use client";

import dynamic from "next/dynamic";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { WorkspacePageSkeleton } from "@/components/common/workspace-page-skeleton";

const WorkspaceNotificationsView = dynamic(
  () =>
    import("@/components/inbox/workspace-notifications-view").then((m) => ({
      default: m.WorkspaceNotificationsView,
    })),
  {
    ssr: false,
    loading: () => <WorkspacePageSkeleton />,
  },
);

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
