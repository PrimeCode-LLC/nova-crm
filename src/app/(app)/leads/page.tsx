"use client";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { LeadsTable } from "@/components/leads/leads-table";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { Kanban, Download, Upload, Bookmark } from "lucide-react";
import Link from "next/link";

export default function LeadsPage() {
  const { leads, isDemo } = useWorkspace();

  return (
    <>
      <PageHeader
        title="Leads"
        description="Every engagement we're working across all channels."
        actions={
          <>
            <Button variant="outline" size="sm">
              <Bookmark className="h-3.5 w-3.5" /> Saved views
            </Button>
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
            <Button variant="outline" size="sm">
              <Upload className="h-3.5 w-3.5" /> Import
            </Button>
            <Button variant="outline" size="sm">
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </>
        }
      />
      <PageBody>
        {!isDemo && leads.length === 0 ? (
          <WorkspaceEmptyHint title="No leads in workspace" />
        ) : (
          <LeadsTable leads={leads} />
        )}
      </PageBody>
    </>
  );
}
