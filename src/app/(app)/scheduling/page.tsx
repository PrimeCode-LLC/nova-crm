"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { AppPage } from "@/components/common/page-header";
import { WorkspacePageSkeleton } from "@/components/common/workspace-page-skeleton";

const SchedulingHub = dynamic(
  () => import("@/components/scheduling/scheduling-hub").then((m) => ({ default: m.SchedulingHub })),
  {
    ssr: false,
    loading: () => <WorkspacePageSkeleton />,
  },
);

export default function SchedulingPage() {
  return (
    <AppPage>
      <React.Suspense fallback={<WorkspacePageSkeleton />}>
        <SchedulingHub />
      </React.Suspense>
    </AppPage>
  );
}
