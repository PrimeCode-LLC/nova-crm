"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Archive as ArchiveIcon, Target, ScanSearch } from "lucide-react";

import { AppPage, PageBody, PageHeader } from "@/components/common/page-header";
import { WorkspacePageSkeleton } from "@/components/common/workspace-page-skeleton";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { filterArchivedLeads, filterActiveLeads } from "@/lib/leads/lead-archive";
import { useCrmEntityPages } from "@/hooks/use-crm-entity-pages";
import { CrmListLoadMore } from "@/components/common/crm-list-load-more";
import { isLiveCrmSnapshotDisabled } from "@/lib/dashboard-kpi-v2-flags";
import { toast } from "sonner";
import { emitBulkLeadOrgActivity } from "@/lib/leads/record-bulk-lead-org-activity";
import { leadDisplayLabel } from "@/lib/leads/lead-display-label";

const LeadsTable = dynamic(
  () => import("@/components/leads/leads-table").then((m) => ({ default: m.LeadsTable })),
  {
    ssr: false,
    loading: () => <WorkspacePageSkeleton />,
  },
);

export default function ArchivePage() {
  const {
    leads: wsLeads,
    isDemo,
    workspaceLoading,
    archiveLead,
    canEditLead,
    currentUserId,
    addOrgActivityEvent,
  } = useWorkspace();
  const snapshotOff = isLiveCrmSnapshotDisabled(isDemo);
  const crmPages = useCrmEntityPages({
    entity: "leads",
    enabled: !isDemo,
    drain: !snapshotOff,
    filters: { archivedOnly: true },
  });
  const leads = React.useMemo(() => {
    if (crmPages.enabled) return crmPages.items as typeof wsLeads;
    return wsLeads;
  }, [crmPages.enabled, crmPages.items, wsLeads]);
  const listLoading = workspaceLoading || (crmPages.enabled && crmPages.loading);

  const archived = React.useMemo(() => filterArchivedLeads(leads), [leads]);
  const lostActive = React.useMemo(
    () => filterActiveLeads(leads).filter((l) => l.stage === "lost"),
    [leads],
  );
  const [archivingLost, setArchivingLost] = React.useState(false);

  const archiveAllLost = React.useCallback(async () => {
    if (isDemo) {
      toast.info("Demo workspace", { description: "Archiving is disabled in sample data." });
      return;
    }
    const targets = lostActive.filter((l) => canEditLead(l));
    if (!targets.length) {
      toast.info("No Lost leads to archive");
      return;
    }
    setArchivingLost(true);
    let done = 0;
    for (const lead of targets) {
      if (await archiveLead(lead.id, { reason: "lost", quiet: true, skipActivity: true })) {
        done += 1;
      }
    }
    setArchivingLost(false);
    if (done > 0 && currentUserId) {
      emitBulkLeadOrgActivity(addOrgActivityEvent, {
        type: "leads_archived",
        actorId: currentUserId,
        count: done,
        leadId: done === 1 ? targets[0]?.id : undefined,
        leadLabel: done === 1 && targets[0] ? leadDisplayLabel(targets[0]) : undefined,
      });
    }
    toast.success(
      done === 1 ? "Archived 1 Lost lead" : `Archived ${done} Lost leads`,
      done < targets.length
        ? { description: `${targets.length - done} could not be archived.` }
        : undefined,
    );
  }, [
    isDemo,
    lostActive,
    canEditLead,
    archiveLead,
    currentUserId,
    addOrgActivityEvent,
  ]);

  return (
    <AppPage>
      <PageHeader
        title="Archive"
        description="Hidden leads and prospects. Restore them to active lists, move salvage rows to Prospects, or delete permanently."
        actions={
          <>
            {lostActive.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                type="button"
                disabled={archivingLost || isDemo}
                onClick={() => {
                  void archiveAllLost();
                }}
              >
                <ArchiveIcon className="h-3.5 w-3.5" />
                {archivingLost
                  ? "Archiving…"
                  : `Archive ${lostActive.length} Lost`}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href="/leads">
                  <Target className="h-3.5 w-3.5" /> Leads
                </Link>
              }
            />
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href="/prospects">
                  <ScanSearch className="h-3.5 w-3.5" /> Prospects
                </Link>
              }
            />
          </>
        }
      />
      <PageBody contained>
        {listLoading ? (
          <WorkspacePageSkeleton />
        ) : !isDemo && archived.length === 0 ? (
          <div className="mx-auto max-w-md space-y-3 rounded-lg border border-dashed bg-muted/20 px-6 py-10 text-center">
            <ArchiveIcon className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">Archive is empty</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {lostActive.length > 0
                ? `You still have ${lostActive.length} Lost lead${lostActive.length === 1 ? "" : "s"} in active lists — use Archive Lost above to clear them from Leads.`
                : "Archived leads and prospects will show up here. From Leads or Prospects, select rows and choose Archive."}
            </p>
          </div>
        ) : (
          <LeadsTable leads={leads} listMode="archived" linkFromKey="archive" />
        )}
        {snapshotOff ? (
          <CrmListLoadMore
            hasMore={crmPages.hasNextPage}
            onLoadMore={() => void crmPages.fetchNextPage()}
          />
        ) : null}
      </PageBody>
    </AppPage>
  );
}
