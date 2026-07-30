"use client";

import * as React from "react";
import { Suspense } from "react";
import type { OrgMemberRole } from "@/lib/types";
import { ActivityLogsClient } from "./activity-logs-client";
import { ErrorLogsClient } from "./error-logs-client";
import { useLogsTab } from "./logs-tab-bar";

type MemberOption = { uid: string; label: string };

function AdminLogsInner({
  orgRole,
  members,
}: {
  orgRole: OrgMemberRole;
  members: MemberOption[];
}) {
  const [tab] = useLogsTab();
  if (tab === "errors") {
    return <ErrorLogsClient orgRole={orgRole} />;
  }
  return <ActivityLogsClient orgRole={orgRole} members={members} />;
}

export function AdminLogsClient(props: {
  orgRole: OrgMemberRole;
  members: MemberOption[];
}) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
          Loading logs…
        </div>
      }
    >
      <AdminLogsInner {...props} />
    </Suspense>
  );
}
