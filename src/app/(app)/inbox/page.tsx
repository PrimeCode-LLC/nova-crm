"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { WorkspacePageSkeleton } from "@/components/common/workspace-page-skeleton";

const InboxWorkspace = dynamic(
  () => import("./inbox-workspace"),
  {
    ssr: false,
    loading: () => <WorkspacePageSkeleton />,
  },
);

export default function InboxPage() {
  return (
    <Suspense fallback={<WorkspacePageSkeleton />}>
      <InboxWorkspace />
    </Suspense>
  );
}
