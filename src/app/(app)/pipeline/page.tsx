"use client";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { KanbanBoard } from "@/components/leads/kanban-board";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { Plus, Table as TableIcon, Filter } from "lucide-react";
import Link from "next/link";

export default function PipelinePage() {
  const { leads, isDemo } = useWorkspace();

  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Drag leads between stages. Stage-required fields validate on drop."
        actions={
          <>
            <Button variant="outline" size="sm">
              <Filter className="h-3.5 w-3.5" /> Filter
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href="/leads">
                  <TableIcon className="h-3.5 w-3.5" /> Table
                </Link>
              }
            />
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" /> New lead
            </Button>
          </>
        }
      />
      <PageBody>
        {!isDemo && leads.length === 0 ? (
          <WorkspaceEmptyHint title="No leads to show on the board" />
        ) : (
          <KanbanBoard leads={leads} />
        )}
      </PageBody>
    </>
  );
}
