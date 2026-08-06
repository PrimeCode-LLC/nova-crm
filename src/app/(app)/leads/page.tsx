"use client";

import * as React from "react";
import { Suspense } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Bookmark, Download, Kanban, Upload, ChevronDown, Archive } from "lucide-react";

import { AppPage, PageBody, PageHeader } from "@/components/common/page-header";
import type { LeadsTableRef, LeadsTablePreset } from "@/components/leads/leads-table";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { WorkspacePageSkeleton } from "@/components/common/workspace-page-skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { ownerScopeFromQueryParam } from "@/lib/owner-scope";
import { filterActiveLeads } from "@/lib/leads/lead-archive";

const LeadsTable = dynamic(
  () => import("@/components/leads/leads-table").then((m) => ({ default: m.LeadsTable })),
  {
    ssr: false,
    loading: () => <WorkspacePageSkeleton />,
  },
);

function LeadsPageInner() {
  const searchParams = useSearchParams();
  const ownerScope = ownerScopeFromQueryParam(searchParams.get("owner"));
  const urlChannelKey = searchParams
    .getAll("channel")
    .filter(Boolean)
    .sort()
    .join("|");
  const urlStageKey = searchParams
    .getAll("stage")
    .filter(Boolean)
    .sort()
    .join("|");
  const idleOnly = searchParams.get("filter") === "idle";

  const { leads, isDemo, workspaceLoading } = useWorkspace();
  const activeLeads = React.useMemo(() => filterActiveLeads(leads), [leads]);
  const salesLeadCount = React.useMemo(
    () => activeLeads.filter((l) => !l.intakeKind || l.intakeKind === "sales_lead").length,
    [activeLeads],
  );
  const tableRef = React.useRef<LeadsTableRef>(null);
  const [tableSession, setTableSession] = React.useState<{
    key: number;
    preset: LeadsTablePreset;
  }>({ key: 0, preset: "default" });

  return (
    <AppPage>
      <PageHeader
        title="Leads"
        description="Pipeline and outreach across channels. Intake-only rows are listed under Prospects in the sidebar."
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Bookmark className="h-3.5 w-3.5" /> Saved views
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  onClick={() =>
                    setTableSession((s) => ({ key: s.key + 1, preset: "default" }))
                  }
                >
                  Default view
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    setTableSession((s) => ({ key: s.key + 1, preset: "high-priority" }))
                  }
                >
                  High priority
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    setTableSession((s) => ({ key: s.key + 1, preset: "ready-outreach" }))
                  }
                >
                  Ready to outreach
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    setTableSession((s) => ({ key: s.key + 1, preset: "needs-sequence" }))
                  }
                >
                  Needs sequence
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    setTableSession((s) => ({ key: s.key + 1, preset: "ready-to-schedule" }))
                  }
                >
                  Ready to schedule
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    setTableSession((s) => ({ key: s.key + 1, preset: "active-outreach" }))
                  }
                >
                  Active outreach
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    setTableSession((s) => ({ key: s.key + 1, preset: "sequence-finished" }))
                  }
                >
                  Sequence finished
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href="/archive">
                  <Archive className="h-3.5 w-3.5" /> Archive
                </Link>
              }
            />
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href="/pipeline">
                  <Kanban className="h-3.5 w-3.5" /> Kanban
                </Link>
              }
            />
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href="/admin/import">
                  <Upload className="h-3.5 w-3.5" /> Import
                </Link>
              }
            />
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={salesLeadCount === 0}
              onClick={() => tableRef.current?.exportFilteredCsv()}
            >
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </>
        }
      />
      <PageBody contained>
        {workspaceLoading ? (
          <WorkspacePageSkeleton />
        ) : !isDemo && salesLeadCount === 0 ? (
          <WorkspaceEmptyHint title="No leads in workspace" />
        ) : (
          <LeadsTable
            ref={tableRef}
            key={`${tableSession.key}-${tableSession.preset}`}
            leads={leads}
            preset={tableSession.preset}
            urlChannelKey={urlChannelKey}
            urlStageKey={urlStageKey}
            idleOnly={idleOnly}
            initialIntakeScope="sales_lead"
            lockedIntakeScope="sales_lead"
            initialOwnerScope={ownerScope}
          />
        )}
      </PageBody>
    </AppPage>
  );
}

export default function LeadsPage() {
  return (
    <Suspense
      fallback={
        <AppPage>
          <PageHeader title="Leads" description="Loading…" />
          <PageBody>
            <p className="text-sm text-muted-foreground">Loading leads…</p>
          </PageBody>
        </AppPage>
      }
    >
      <LeadsPageInner />
    </Suspense>
  );
}
