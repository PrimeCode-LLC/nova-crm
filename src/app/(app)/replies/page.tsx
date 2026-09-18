"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageSquareReply } from "lucide-react";

import { AppPage, PageBody, PageHeader } from "@/components/common/page-header";
import { ChannelChip } from "@/components/common/channel-chip";
import { StageBadge } from "@/components/common/stage-badge";
import { UserChip } from "@/components/common/user-chip";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { WorkspacePageSkeleton } from "@/components/common/workspace-page-skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import { useCrmEntityPages } from "@/hooks/use-crm-entity-pages";
import { selectTriggerLabelByKey } from "@/lib/base-ui-select-label";
import {
  DASHBOARD_TIME_RANGE_LABELS,
  parseDashboardTimeRangeKey,
  type DashboardTimeRangeKey,
} from "@/lib/dashboard-date-range";
import { listLeadsRepliedInRange } from "@/lib/dashboard-workflow";
import { fmtRelative } from "@/lib/format";
import { hasPendingReplyReview } from "@/lib/leads/reply-review";
import { isProspectRow } from "@/lib/prospects/prospect-access";
import type { Lead } from "@/lib/types";
import { cn } from "@/lib/utils";

const RANGE_OPTIONS = (
  Object.entries(DASHBOARD_TIME_RANGE_LABELS) as [DashboardTimeRangeKey, string][]
).map(([key, label]) => ({ key, label }));

function leadHref(lead: Lead): string {
  return isProspectRow(lead) ? `/leads/${lead.id}?from=prospects` : `/leads/${lead.id}`;
}

function RepliesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { leads: wsLeads, isDemo, workspaceLoading } = useWorkspace();
  const crmPages = useCrmEntityPages({
    entity: "leads",
    enabled: !isDemo,
    drain: true,
  });
  const leads = React.useMemo(() => {
    if (crmPages.enabled) return crmPages.items as typeof wsLeads;
    return wsLeads;
  }, [crmPages.enabled, crmPages.items, wsLeads]);
  const listLoading = workspaceLoading || (crmPages.enabled && crmPages.loading);
  const timeZone = useOrgTimezone();

  const range = parseDashboardTimeRangeKey(searchParams.get("range"), "30d");
  const reviewOnly = searchParams.get("review") === "pending";

  const replied = React.useMemo(
    () => listLeadsRepliedInRange(leads, range, { timeZone }),
    [leads, range, timeZone],
  );

  const visible = React.useMemo(
    () => (reviewOnly ? replied.filter(hasPendingReplyReview) : replied),
    [replied, reviewOnly],
  );

  const pendingCount = React.useMemo(
    () => replied.filter(hasPendingReplyReview).length,
    [replied],
  );

  function setRange(next: DashboardTimeRangeKey) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", next);
    router.replace(`/replies?${params.toString()}`);
  }

  function setReviewOnly(next: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("review", "pending");
    else params.delete("review");
    router.replace(`/replies?${params.toString()}`);
  }

  return (
    <AppPage>
      <PageHeader
        title="Replies"
        description={`Prospects and leads that replied · ${DASHBOARD_TIME_RANGE_LABELS[range].toLowerCase()}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={range}
              onValueChange={(v) => {
                if (!v || v === range) return;
                setRange(v as DashboardTimeRangeKey);
              }}
            >
              <SelectTrigger className="h-8 w-[160px]" size="sm">
                <SelectValue>
                  {selectTriggerLabelByKey(range, RANGE_OPTIONS) ?? undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.key} value={opt.key}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />
      <PageBody contained>
        {listLoading ? (
          <WorkspacePageSkeleton />
        ) : !isDemo && replied.length === 0 && leads.length === 0 ? (
          <WorkspaceEmptyHint title="No replies yet" description="Inbound replies will show up here." />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setReviewOnly(false)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  !reviewOnly
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/40",
                )}
              >
                All replies
                <span className="ml-1.5 tabular-nums text-muted-foreground">{replied.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setReviewOnly(true)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  reviewOnly
                    ? "border-warning/40 bg-warning/10 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/40",
                )}
              >
                To review
                <span className="ml-1.5 tabular-nums text-muted-foreground">{pendingCount}</span>
              </button>
            </div>

            {visible.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {reviewOnly
                  ? "No replies waiting for review in this range."
                  : `No replies in ${DASHBOARD_TIME_RANGE_LABELS[range].toLowerCase()}.`}
              </p>
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {visible.map((lead) => {
                  const prospect = isProspectRow(lead);
                  const pending = hasPendingReplyReview(lead);
                  return (
                    <li key={lead.id}>
                      <Link
                        href={leadHref(lead)}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                      >
                        <MessageSquareReply
                          className="h-4 w-4 shrink-0 text-chart-2"
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium">
                              {lead.contactName || "Contact"}
                            </span>
                            <ChannelChip channel={lead.channel} compact />
                            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                              {prospect ? "Prospect" : "Lead"}
                            </Badge>
                            {pending ? (
                              <Badge
                                variant="outline"
                                className="border-warning/30 bg-warning/10 text-[10px] text-warning"
                              >
                                To review
                              </Badge>
                            ) : null}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {lead.companyName || "—"}
                            {lead.lastReplySource ? ` · via ${lead.lastReplySource}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <StageBadge stage={lead.stage} />
                          <div className="hidden w-28 md:block">
                            <UserChip userId={lead.ownerId} size="xs" />
                          </div>
                          <span className="w-20 text-right text-xs tabular-nums text-muted-foreground">
                            {lead.lastReplyAt ? fmtRelative(lead.lastReplyAt) : "—"}
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </PageBody>
    </AppPage>
  );
}

export default function RepliesPage() {
  return (
    <Suspense
      fallback={
        <AppPage>
          <PageHeader title="Replies" description="Loading…" />
          <PageBody>
            <p className="text-sm text-muted-foreground">Loading replies…</p>
          </PageBody>
        </AppPage>
      }
    >
      <RepliesPageInner />
    </Suspense>
  );
}
