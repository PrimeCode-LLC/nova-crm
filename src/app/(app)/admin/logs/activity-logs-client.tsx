"use client";

import * as React from "react";
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
import { CHANNEL_LIST } from "@/lib/constants";
import { Input } from "@/components/ui/input";
import type { AuditAnalyticsResult } from "@/lib/audit-analytics";
import { ActivityLogsDashboard } from "./activity-logs-dashboard";

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

export function ActivityLogsClient({
  orgRole,
  members,
}: {
  orgRole: OrgMemberRole;
  members: MemberOption[];
}) {
  const canView = roleAtLeast(orgRole, "admin");
  const [items, setItems] = React.useState<AuditRow[]>([]);
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

  const load = React.useCallback(
    async (pageNum: number) => {
      if (!canView) return;
      const params = new URLSearchParams({ limit: String(pageSize) });
      const cursor = cursorsRef.current[pageNum - 1];
      if (cursor) params.set("cursor", cursor);
      if (category !== "all") params.set("category", category);
      if (actorUid !== "all") params.set("actorUid", actorUid);

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
    [canView, category, actorUid, pageSize],
  );

  const loadAnalytics = React.useCallback(async () => {
    if (!canView) return;
    const params = new URLSearchParams({ range: timeRange });
    if (actorUid !== "all") params.set("actorUid", actorUid);
    if (channel !== "all") params.set("channel", channel);
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
  }, [canView, timeRange, actorUid, channel, dateFrom, dateTo]);

  const refreshAll = React.useCallback(() => {
    cursorsRef.current = [null];
    if (page === 1) {
      void load(1);
    } else {
      setPage(1);
    }
    void loadAnalytics();
  }, [page, load, loadAnalytics]);

  React.useEffect(() => {
    void load(page);
  }, [page, load]);

  React.useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

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
                {CHANNEL_LIST.map((c) => (
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

        <Card className="overflow-visible">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="h-4 w-4" />
              Detailed audit trail
            </CardTitle>
            <CardDescription>
              Newest events first. Stage changes on leads and prospects are recorded here automatically.
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
                {actorUid !== "all" || category !== "all"
                  ? "No activity matches these filters. Try Everyone or a different category."
                  : "No activity recorded yet. Events appear as your team uses the CRM, AI tools, and admin settings."}
              </p>
            ) : (
              <Table className="min-w-[1060px] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[130px]">Created at</TableHead>
                    <TableHead className="w-[80px]">Operation</TableHead>
                    <TableHead className="w-[100px]">Table</TableHead>
                    <TableHead className="w-[90px]">Field</TableHead>
                    <TableHead className="w-[200px]">Message</TableHead>
                    <TableHead className="w-[150px]">Previous</TableHead>
                    <TableHead className="w-[150px]">Updated</TableHead>
                    <TableHead className="w-[180px]">Account</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => {
                    const cat = categoryForAuditEvent(row.event);
                    const accountLabel = row.actorEmail ?? row.actorDisplayName ?? "—";
                    return (
                      <TableRow key={row.id}>
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
