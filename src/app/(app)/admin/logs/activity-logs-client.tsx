"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Loader2,
  RefreshCw,
  ScrollText,
  Filter,
  User,
  ChevronLeft,
  ChevronRight,
  Calendar,
  BarChart3,
  GitBranch,
  X,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate, fmtRelative } from "@/lib/format";
import {
  categoryForAuditEvent,
  type AuditEventCategory,
} from "@/lib/firestore/audit-events";
import type { AuditOperation } from "@/lib/firestore/audit";
import type { OrgMemberRole } from "@/lib/types";
import { roleAtLeast } from "@/lib/platform/org-role";
import { useChannelOptions } from "@/hooks/use-channel-options";
import { Input } from "@/components/ui/input";
import type { AuditAnalyticsResult } from "@/lib/audit-analytics";
import { ActivityLogsDashboard } from "./activity-logs-dashboard";
import { cn } from "@/lib/utils";
import type { StageHistoryEntry } from "@/lib/audit-stage-history";

type AuditRow = {
  id: string;
  actorUid: string;
  actorDisplayName: string;
  actorEmail: string | null;
  actorOrgRole: OrgMemberRole | null;
  event: string;
  category: AuditEventCategory;
  meta: Record<string, unknown>;
  createdAt: string | null;
  operation: AuditOperation | null;
  tableName: string | null;
  fieldName: string | null;
  message: string | null;
  prevValue: string | null;
  updatedValue: string | null;
  leadId: string | null;
  leadLabel: string | null;
};

type MemberOption = { uid: string; label: string };

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

const TIME_RANGE_OPTIONS = [
  { value: "1d", label: "Last day" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "custom", label: "Custom range" },
] as const;

const CATEGORY_LABELS: Record<AuditEventCategory, string> = {
  team: "Team",
  crm: "CRM",
  ai: "AI",
  integrations: "Integrations",
  settings: "Settings",
  usage: "Feature usage",
};

const CATEGORY_VARIANT: Record<
  AuditEventCategory,
  "default" | "secondary" | "outline" | "destructive"
> = {
  team: "secondary",
  crm: "outline",
  ai: "default",
  integrations: "secondary",
  settings: "outline",
  usage: "default",
};

function ScrollableValue({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <div
      className="max-w-[140px] overflow-x-auto overscroll-x-contain [scrollbar-width:thin]"
      title={value}
    >
      <span className="font-mono text-xs whitespace-nowrap inline-block">{value}</span>
    </div>
  );
}

function formatOperation(op: AuditOperation | null): string {
  if (!op) return "—";
  return op.charAt(0).toUpperCase() + op.slice(1);
}

function leadIdFromRow(row: AuditRow): string | null {
  if (row.leadId?.trim()) return row.leadId.trim();
  const fromMeta = row.meta?.leadId;
  return typeof fromMeta === "string" && fromMeta.trim() ? fromMeta.trim() : null;
}

function LeadStageHistoryStrip({
  loading,
  history,
}: {
  loading: boolean;
  history: StageHistoryEntry[];
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border/60 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold leading-none">
          <GitBranch className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          Stage history
        </h3>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Creation and stage changes for this lead, oldest first.
        </p>
      </div>

      <div className="px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading stage history…
          </div>
        ) : history.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No stage changes recorded for this lead yet.
            </p>
            <p className="mt-1 text-xs text-muted-foreground/80">
              Changes appear here after a stage is updated in live mode.
            </p>
          </div>
        ) : (
          <ol className="relative space-y-0 border-l border-border/80 pl-4">
            {history.map((entry, index) => (
              <li key={entry.id} className={cn("relative pb-4", index === history.length - 1 && "pb-0")}>
                <span
                  className="absolute top-1.5 -left-[calc(0.25rem+1px)] h-2 w-2 rounded-full border-2 border-background bg-primary"
                  aria-hidden
                />
                <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <time className="tabular-nums" title={fmtDate(entry.at, "PPpp")}>
                      {entry.at ? fmtDate(entry.at, "MMM d, yyyy h:mm a") : "—"}
                    </time>
                    {entry.source === "timeline" ? (
                      <Badge variant="outline" className="h-5 text-[10px] font-normal">
                        timeline
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1.5 text-sm leading-snug">
                    <span className="font-medium text-foreground">{entry.actorName ?? "Unknown"}</span>
                    <span className="text-muted-foreground">
                      {entry.kind === "created" ? " created this lead" : ` · ${entry.summary}`}
                    </span>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export function ActivityLogsClient({
  orgRole,
  members,
}: {
  orgRole: OrgMemberRole;
  members: MemberOption[];
}) {
  const canView = roleAtLeast(orgRole, "admin");
  const channelOptions = useChannelOptions({ includeDisabled: true });
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const leadIdFilter = searchParams.get("leadId")?.trim() || null;

  const [items, setItems] = React.useState<AuditRow[]>([]);
  const [stageHistory, setStageHistory] = React.useState<StageHistoryEntry[]>([]);
  const [stageHistoryLoading, setStageHistoryLoading] = React.useState(false);
  const [stageHistoryLabel, setStageHistoryLabel] = React.useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = React.useState(false);
  const [totalCount, setTotalCount] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] =
    React.useState<(typeof PAGE_SIZE_OPTIONS)[number]>(25);
  const [category, setCategory] = React.useState<string>("all");
  const [actorUid, setActorUid] = React.useState<string>("all");
  const [channel, setChannel] = React.useState<string>("all");
  const [timeRange, setTimeRange] = React.useState<string>("30d");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [analytics, setAnalytics] = React.useState<AuditAnalyticsResult | null>(null);
  const [analyticsLabels, setAnalyticsLabels] = React.useState<Record<string, string>>({});
  const [analyticsLoading, setAnalyticsLoading] = React.useState(true);
  const [filterMembers, setFilterMembers] = React.useState<MemberOption[]>(members);
  const cursorsRef = React.useRef<(string | null)[]>([null]);

  React.useEffect(() => {
    setFilterMembers(members);
  }, [members]);

  const memberLabelByUid = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const m of filterMembers) map.set(m.uid, m.label);
    for (const row of items) {
      if (row.actorUid && row.actorDisplayName) {
        map.set(row.actorUid, row.actorDisplayName);
      }
    }
    return map;
  }, [filterMembers, items]);

  const actorFilterLabel =
    actorUid === "all" ? "Everyone" : (memberLabelByUid.get(actorUid) ?? "Team member");

  const resetPagination = React.useCallback(() => {
    cursorsRef.current = [null];
    setPage(1);
  }, []);

  const setLeadIdFilter = React.useCallback(
    (leadId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (leadId) params.set("leadId", leadId);
      else params.delete("leadId");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
      resetPagination();
    },
    [searchParams, router, pathname, resetPagination],
  );

  const trackingLabel = React.useMemo(() => {
    if (!leadIdFilter) return null;
    if (stageHistoryLabel?.trim()) return stageHistoryLabel.trim();
    for (const row of items) {
      if (row.leadId === leadIdFilter && row.leadLabel?.trim()) {
        return row.leadLabel.trim();
      }
    }
    const fromMeta = items.find(
      (r) => leadIdFromRow(r) === leadIdFilter && typeof r.meta.leadName === "string",
    )?.meta.leadName;
    if (typeof fromMeta === "string" && fromMeta.trim()) return fromMeta.trim();
    return leadIdFilter;
  }, [leadIdFilter, items, stageHistoryLabel]);

  const load = React.useCallback(
    async (pageNum: number) => {
      if (!canView) return;
      const params = new URLSearchParams({ limit: String(pageSize) });
      const cursor = cursorsRef.current[pageNum - 1];
      if (cursor) params.set("cursor", cursor);
      if (category !== "all") params.set("category", category);
      if (actorUid !== "all") params.set("actorUid", actorUid);
      if (leadIdFilter) params.set("leadId", leadIdFilter);

      setLoading(true);

      try {
        const res = await fetch(`/api/org/audit-logs?${params}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Failed (${res.status})`);
        }
        const data = (await res.json()) as {
          items: AuditRow[];
          nextCursor: string | null;
          totalCount?: number;
          hasMore?: boolean;
          filterMembers?: MemberOption[];
        };
        cursorsRef.current = [...cursorsRef.current.slice(0, pageNum), data.nextCursor];
        setHasNextPage(data.hasMore ?? !!data.nextCursor);
        setTotalCount(data.totalCount ?? data.items.length);
        setItems(data.items);
        if (data.filterMembers?.length) {
          setFilterMembers(data.filterMembers);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not load activity logs");
      } finally {
        setLoading(false);
      }
    },
    [canView, category, actorUid, pageSize, leadIdFilter],
  );

  const loadStageHistory = React.useCallback(async () => {
    if (!canView || !leadIdFilter) {
      setStageHistory([]);
      setStageHistoryLabel(null);
      return;
    }
    setStageHistoryLoading(true);
    try {
      const res = await fetch(`/api/org/leads/${encodeURIComponent(leadIdFilter)}/stage-history`);
      if (!res.ok) {
        setStageHistory([]);
        return;
      }
      const data = (await res.json()) as {
        history: StageHistoryEntry[];
        leadLabel?: string | null;
      };
      setStageHistory(data.history ?? []);
      setStageHistoryLabel(data.leadLabel ?? null);
    } catch {
      setStageHistory([]);
    } finally {
      setStageHistoryLoading(false);
    }
  }, [canView, leadIdFilter]);

  const loadAnalytics = React.useCallback(async () => {
    if (!canView) return;
    const params = new URLSearchParams({ range: timeRange });
    if (actorUid !== "all") params.set("actorUid", actorUid);
    if (channel !== "all") params.set("channel", channel);
    if (leadIdFilter) params.set("leadId", leadIdFilter);
    if (timeRange === "custom") {
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
    }

    setAnalyticsLoading(true);
    try {
      const res = await fetch(`/api/org/audit-analytics?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      const data = (await res.json()) as {
        analytics: AuditAnalyticsResult;
        memberLabels: Record<string, string>;
      };
      setAnalytics(data.analytics);
      setAnalyticsLabels(data.memberLabels);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load analytics");
    } finally {
      setAnalyticsLoading(false);
    }
  }, [canView, timeRange, actorUid, channel, dateFrom, dateTo, leadIdFilter]);

  const refreshAll = React.useCallback(() => {
    cursorsRef.current = [null];
    if (page === 1) {
      void load(1);
    } else {
      setPage(1);
    }
    void loadAnalytics();
    void loadStageHistory();
  }, [page, load, loadAnalytics, loadStageHistory]);

  React.useEffect(() => {
    void load(page);
  }, [page, load]);

  React.useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  React.useEffect(() => {
    void loadStageHistory();
  }, [loadStageHistory]);

  if (!canView) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader
          title="Activity logs"
          description="Workspace owners and admins can review who used which tools and when."
        />
        <PageBody>
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              You need owner or admin access on this workspace to view activity logs.
            </CardContent>
          </Card>
        </PageBody>
      </div>
    );
  }

  const rangeStart = items.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = items.length === 0 ? 0 : rangeStart + items.length - 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Activity logs"
        description="Team intelligence from the audit log — analytics above, detailed event trail below."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={loading || analyticsLoading}
            onClick={refreshAll}
          >
            {loading || analyticsLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2">Refresh</span>
          </Button>
        }
      />
      <PageBody className="min-h-0 flex-1 space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Period
            </span>
            <Select
              value={timeRange}
              onValueChange={(v) => {
                if (v) setTimeRange(v);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Period" />
              </SelectTrigger>
              <SelectContent>
                {TIME_RANGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {timeRange === "custom" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="audit-from" className="text-xs text-muted-foreground">
                  From
                </Label>
                <Input
                  id="audit-from"
                  type="date"
                  className="w-[150px] h-9"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="audit-to" className="text-xs text-muted-foreground">
                  To
                </Label>
                <Input
                  id="audit-to"
                  type="date"
                  className="w-[150px] h-9"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </>
          ) : null}
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <User className="h-3 w-3" />
              Team member
            </span>
            <Select
              value={actorUid}
              onValueChange={(v) => {
                setActorUid(v ?? "all");
                resetPagination();
              }}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Everyone">{actorFilterLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                {filterMembers.map((m) => (
                  <SelectItem key={m.uid} value={m.uid}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <BarChart3 className="h-3 w-3" />
              Channel
            </span>
            <Select value={channel} onValueChange={(v) => setChannel(v ?? "all")}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All channels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All channels</SelectItem>
                {channelOptions.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Filter className="h-3 w-3" />
              Log category
            </span>
            <Select
              value={category}
              onValueChange={(v) => {
                setCategory(v ?? "all");
                resetPagination();
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {(Object.keys(CATEGORY_LABELS) as AuditEventCategory[]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <ActivityLogsDashboard
          analytics={analytics}
          memberLabels={analyticsLabels}
          loading={analyticsLoading}
          channelFilter={channel}
        />

        {leadIdFilter ? (
          <div className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                Tracking: <span className="text-primary">{trackingLabel}</span>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Showing all audit events linked to this lead. Click a lead name in the table to switch.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link
                href={`/leads/${leadIdFilter}`}
                className="inline-flex h-7 items-center gap-1 rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-[0.8rem] font-medium hover:bg-muted"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open lead
              </Link>
              <Button variant="secondary" size="sm" onClick={() => setLeadIdFilter(null)}>
                <X className="h-3.5 w-3.5" />
                Clear filter
              </Button>
            </div>
          </div>
        ) : null}

        {leadIdFilter ? (
          <LeadStageHistoryStrip loading={stageHistoryLoading} history={stageHistory} />
        ) : null}

        <Card className="overflow-visible">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="h-4 w-4" />
              Detailed audit trail
            </CardTitle>
            <CardDescription>
              {leadIdFilter
                ? "All recorded events for this lead, newest first. Click any other lead row to track a different lead."
                : "Newest events first. Click a lead name to track all activity for that lead."}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading logs…
              </div>
            ) : items.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                {leadIdFilter
                  ? "No audit events found for this lead."
                  : actorUid !== "all" || category !== "all"
                    ? "No activity matches these filters. Try Everyone or a different category."
                    : "No activity recorded yet. Events appear as your team uses the CRM, AI tools, and admin settings."}
              </p>
            ) : (
              <Table className="min-w-[1180px] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[130px]">Created at</TableHead>
                    <TableHead className="w-[80px]">Operation</TableHead>
                    <TableHead className="w-[100px]">Table</TableHead>
                    <TableHead className="w-[90px]">Field</TableHead>
                    <TableHead className="w-[200px]">Message</TableHead>
                    <TableHead className="w-[140px]">Lead</TableHead>
                    <TableHead className="w-[130px]">Previous</TableHead>
                    <TableHead className="w-[130px]">Updated</TableHead>
                    <TableHead className="w-[160px]">Account</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => {
                    const cat = categoryForAuditEvent(row.event);
                    const accountLabel = row.actorEmail ?? row.actorDisplayName ?? "—";
                    const rowLeadId = leadIdFromRow(row);
                    const rowLeadLabel =
                      row.leadLabel?.trim() ||
                      (typeof row.meta.leadName === "string" ? row.meta.leadName.trim() : null);
                    const isTrackable = Boolean(rowLeadId);
                    const isTracked = rowLeadId === leadIdFilter;

                    return (
                      <TableRow
                        key={row.id}
                        className={cn(
                          isTrackable && "cursor-pointer hover:bg-muted/40",
                          isTracked && "bg-primary/5",
                        )}
                        onClick={
                          isTrackable
                            ? () => setLeadIdFilter(rowLeadId)
                            : undefined
                        }
                        aria-label={
                          isTrackable ? "Track all activity for this lead" : undefined
                        }
                      >
                        <TableCell className="align-top whitespace-normal text-sm">
                          <div className="font-medium tabular-nums">
                            {fmtRelative(row.createdAt ?? undefined)}
                          </div>
                          <div className="text-xs text-muted-foreground whitespace-nowrap">
                            {fmtDate(row.createdAt ?? undefined, "MMM d, yyyy h:mm a")}
                          </div>
                        </TableCell>
                        <TableCell className="align-top whitespace-normal text-sm capitalize">
                          {formatOperation(row.operation)}
                        </TableCell>
                        <TableCell className="align-top whitespace-normal text-xs font-mono">
                          {row.tableName ?? "—"}
                        </TableCell>
                        <TableCell className="align-top whitespace-normal text-xs font-mono">
                          {row.fieldName ?? "—"}
                        </TableCell>
                        <TableCell className="align-top whitespace-normal text-sm">
                          <div className="flex flex-col gap-1 min-w-0">
                            <span className="line-clamp-2">{row.message ?? "—"}</span>
                            <Badge variant={CATEGORY_VARIANT[cat]} className="w-fit text-[10px]">
                              {CATEGORY_LABELS[cat]}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="align-top whitespace-normal text-sm">
                          {rowLeadId ? (
                            <button
                              type="button"
                              className={cn(
                                "max-w-full truncate text-left font-medium hover:text-primary hover:underline",
                                isTracked && "text-primary",
                              )}
                              onClick={(e) => {
                                e.stopPropagation();
                                setLeadIdFilter(rowLeadId);
                              }}
                            >
                              {rowLeadLabel ?? rowLeadId}
                            </button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="align-top whitespace-normal overflow-hidden">
                          <ScrollableValue value={row.prevValue} />
                        </TableCell>
                        <TableCell className="align-top whitespace-normal overflow-hidden">
                          <ScrollableValue value={row.updatedValue} />
                        </TableCell>
                        <TableCell className="align-top whitespace-normal text-sm">
                          <div className="font-medium truncate" title={accountLabel}>
                            {accountLabel}
                          </div>
                          {row.actorEmail && row.actorDisplayName && (
                            <div className="text-xs text-muted-foreground truncate">
                              {row.actorDisplayName}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {loading && items.length === 0
                ? "Loading activity…"
                : totalCount === 0
                  ? "No events in audit log"
                  : items.length === 0
                    ? `No events on page ${page} (${totalCount} total)`
                    : `Showing ${rangeStart}–${rangeEnd} of ${totalCount} event${totalCount === 1 ? "" : "s"}`}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Label htmlFor="activity-log-page-size" className="text-sm text-muted-foreground">
                  Per page
                </Label>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    if (!v) return;
                    setPageSize(Number(v) as (typeof PAGE_SIZE_OPTIONS)[number]);
                    resetPagination();
                  }}
                >
                  <SelectTrigger id="activity-log-page-size" className="h-8 w-[72px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <span className="min-w-[5rem] px-2 text-center text-sm font-medium tabular-nums">
                  Page {page}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasNextPage || loading}
                  onClick={() => setPage((p) => p + 1)}
                  aria-label="Next page"
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          </CardFooter>
        </Card>
      </PageBody>
    </div>
  );
}
