"use client";

import dynamic from "next/dynamic";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { WorkspacePageSkeleton } from "@/components/common/workspace-page-skeleton";

const WorkspaceTeamChatPanel = dynamic(
  () =>
    import("@/components/inbox/workspace-team-chat-panel").then((m) => ({
      default: m.WorkspaceTeamChatPanel,
    })),
  {
    ssr: false,
    loading: () => <WorkspacePageSkeleton />,
  },
);

export default function TeamChatPage() {
  const { users, currentUserId, isDemo, organizationId } = useWorkspace();

  return (
    <>
      <PageHeader
        title="Team chat"
        description="Channels and direct messages for your organization, like Slack, inside your CRM."
      />
      <PageBody className="flex min-h-0 flex-1 flex-col space-y-0 overflow-hidden p-0">
        <WorkspaceTeamChatPanel
          users={users}
          currentUserId={currentUserId}
          isDemo={isDemo}
          organizationId={organizationId}
        />
      </PageBody>
    </>
  );
}
