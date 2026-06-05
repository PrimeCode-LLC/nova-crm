"use client";

import dynamic from "next/dynamic";
import { WorkspacePageSkeleton } from "@/components/common/workspace-page-skeleton";

const FitCheckClient = dynamic(
  () => import("@/components/fit-check/fit-check-client").then((m) => ({ default: m.FitCheckClient })),
  {
    ssr: false,
    loading: () => <WorkspacePageSkeleton />,
  },
);

export default function FitCheckPageClient() {
  return <FitCheckClient />;
}
