"use client";

import * as React from "react";
import { Suspense } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Bookmark, Download, FilePenLine, Kanban, Upload, ChevronDown, Target, Archive } from "lucide-react";

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
import { useOpenQuickAdd } from "@/components/layout/quick-add-launcher";
import { ownerScopeFromQueryParam } from "@/lib/owner-scope";
import { ProspectDraftBanner } from "@/components/prospects/prospect-draft-banner";
import { filterActiveLeads } from "@/lib/leads/lead-archive";
import { useCrmEntityPages } from "@/hooks/use-crm-entity-pages";
import { CrmListLoadMore } from "@/components/common/crm-list-load-more";

const LeadsTable = dynamic(
  () => import("@/components/leads/leads-table").then((m) => ({ default: m.LeadsTable })),
  {
    ssr: false,
    loading: () => <WorkspacePageSkeleton />,
  },
);

function ProspectsPageInner() {
  const searchParams = useSearchParams();
  const ownerScope = ownerScopeFromQueryParam(searchParams.get("owner"));
  const { leads: wsLeads, isDemo, workspaceLoading } = useWorkspace();
  const { openNewProspectForm } = useOpenQuickAdd();
  const crmPages = useCrmEntityPages({
    entity: "leads",
    enabled: !isDemo,
    filters: { activeOnly: true, intakeKind: "prospect" },
  });
  const leads = React.useMemo(() => {
    if (crmPages.enabled) return crmPages.items as typeof wsLeads;
    return wsLeads;
  }, [crmPages.enabled, crmPages.items, wsLeads]);
  const listLoading = workspaceLoading || (crmPages.enabled && crmPages.loading);
  const tableRef = React.useRef<LeadsTableRef>(null);
  const [tableSession, setTableSession] = React.useState<{
    key: number;
    preset: LeadsTablePreset;
  }>({ key: 0, preset: "default" });

  const prospectCount = React.useMemo(
    () => filterActiveLeads(leads).filter((l) => l.intakeKind === "prospect").length,
    [leads],
  );

  return (
    <AppPage>
      <PageHeader
        title="Prospects"
        description="Intake records from research. Prospect owners assign channels and teammates; assignees push their channel into one shared sales lead."
        actions={
          <>
            <Button
              size="sm"
              type="button"
              onClick={() =>
                openNewProspectForm({
                  source: "prospects_page",
                  destination: "/prospects",
                })
              }
            >
              New prospect
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href="/prospects/drafts">
                  <FilePenLine className="h-3.5 w-3.5" /> Drafts
                </Link>
              }
            />
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
                  onClick={() => setTableSession((s) => ({ key: s.key + 1, preset: "default" }))}
                >
                  Default view
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setTableSession((s) => ({ key: s.key + 1, preset: "high-priority" }))}
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
                <Link href="/prospects?owner=me">
                  <Target className="h-3.5 w-3.5" /> My prospects
                </Link>
              }
            />
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href="/leads">
                  <Target className="h-3.5 w-3.5" /> All leads
                </Link>
              }
            />
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
              disabled={prospectCount === 0}
              onClick={() => tableRef.current?.exportFilteredCsv()}
            >
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </>
        }
      />
      <PageBody contained>
        <ProspectDraftBanner />
        {listLoading ? (
          <WorkspacePageSkeleton />
        ) : !isDemo && prospectCount === 0 ? (
          <WorkspaceEmptyHint
            title="No prospects yet"
            description="Use New prospect (full form) or ask your admin about imports to add intake rows. They stay here until you promote them to sales leads."
          />
        ) : (
          <LeadsTable
            ref={tableRef}
            key={`${tableSession.key}-${tableSession.preset}-prospects`}
            leads={leads}
            preset={tableSession.preset}
            urlChannelKey=""
            urlStageKey=""
            idleOnly={false}
            initialIntakeScope="prospect"
            lockedIntakeScope="prospect"
            linkFromKey="prospects"
            initialOwnerScope={ownerScope}
          />
        )}
        <CrmListLoadMore
          hasMore={crmPages.hasNextPage}
          onLoadMore={() => void crmPages.fetchNextPage()}
        />
      </PageBody>
    </AppPage>
  );
}

export default function ProspectsPage() {
  return (
    <Suspense
      fallback={
        <AppPage>
          <PageHeader title="Prospects" description="Loading…" />
          <PageBody>
            <p className="text-sm text-muted-foreground">Loading…</p>
          </PageBody>
        </AppPage>
      }
    >
      <ProspectsPageInner />
    </Suspense>
  );
}
