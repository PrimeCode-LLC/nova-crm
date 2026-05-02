"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Bookmark, Download, Kanban, Upload, ChevronDown } from "lucide-react";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { LeadsTable, type LeadsTableRef, type LeadsTablePreset } from "@/components/leads/leads-table";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";

function LeadsPageInner() {
  const searchParams = useSearchParams();
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

  const { leads, isDemo } = useWorkspace();
  const tableRef = React.useRef<LeadsTableRef>(null);
  const [tableSession, setTableSession] = React.useState<{
    key: number;
    preset: LeadsTablePreset;
  }>({ key: 0, preset: "default" });

  return (
    <>
      <PageHeader
        title="Leads"
        description="Every engagement we're working across all channels."
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
              <DropdownMenuContent align="end" className="w-48">
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
              </DropdownMenuContent>
            </DropdownMenu>
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
              disabled={leads.length === 0}
              onClick={() => tableRef.current?.exportFilteredCsv()}
            >
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </>
        }
      />
      <PageBody>
        {!isDemo && leads.length === 0 ? (
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
          />
        )}
      </PageBody>
    </>
  );
}

export default function LeadsPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Leads" description="Loading…" />
          <PageBody>
            <p className="text-sm text-muted-foreground">Loading leads…</p>
          </PageBody>
        </>
      }
    >
      <LeadsPageInner />
    </Suspense>
  );
}
