"use client";

import dynamic from "next/dynamic";
import { WorkspacePageSkeleton } from "@/components/common/workspace-page-skeleton";
import type { ComponentProps } from "react";

const PeoplePageClient = dynamic(
  () => import("./people-client").then((m) => ({ default: m.PeoplePageClient })),
  {
    ssr: false,
    loading: () => <WorkspacePageSkeleton />,
  },
);

export function PeoplePageShell(props: ComponentProps<typeof PeoplePageClient>) {
  return <PeoplePageClient {...props} />;
}
