"use client";

import * as React from "react";
import {
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Search,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
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
import { fmtDate } from "@/lib/format";
import type { OrgMemberRole } from "@/lib/types";
import { roleAtLeast } from "@/lib/platform/org-role";
import type { ErrorLogRecord, ErrorLogSource } from "@/lib/error-logging/types";
import { cn } from "@/lib/utils";
import { LogsTabBar } from "./logs-tab-bar";

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Inclusive last 7 calendar days (today and 6 days before). */
function last7DaysRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  return { from: toYmd(from), to: toYmd(to) };
}

type ErrorLogsClientProps = {
  orgRole: OrgMemberRole;
};

export function ErrorLogsClient({ orgRole }: ErrorLogsClientProps) {
  const canView = roleAtLeast(orgRole, "admin");
  const initialRange = React.useMemo(() => last7DaysRange(), []);
  const [items, setItems] = React.useState<ErrorLogRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [cursorStack, setCursorStack] = React.useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = React.useState(0);
  const [totalCount, setTotalCount] = React.useState(0);
  const [pageSize, setPageSize] = React.useState<(typeof PAGE_SIZE_OPTIONS)[number]>(25);
  const [source, setSource] = React.useState<"all" | ErrorLogSource>("all");
  const [search, setSearch] = React.useState("");
  const [searchApplied, setSearchApplied] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState(initialRange.from);
  const [dateTo, setDateTo] = React.useState(initialRange.to);
  const [dateFromApplied, setDateFromApplied] = React.useState(initialRange.from);
  const [dateToApplied, setDateToApplied] = React.useState(initialRange.to);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const last7 = last7DaysRange();
  const isDefaultLast7 =
    dateFromApplied === last7.from && dateToApplied === last7.to;

  const load = React.useCallback(
    async (cursor: string | null) => {
      if (!canView) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("limit", String(pageSize));
        if (cursor) params.set("cursor", cursor);
        if (source !== "all") params.set("source", source);
        if (searchApplied.trim()) params.set("search", searchApplied.trim());
        if (dateFromApplied) params.set("from", dateFromApplied);
        if (dateToApplied) params.set("to", dateToApplied);

        const res = await fetch(`/api/org/error-logs?${params}`);
        const data = (await res.json()) as {
          items?: ErrorLogRecord[];
          nextCursor?: string | null;
          totalCount?: number;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || "Could not load error logs.");
        }
        setItems(data.items ?? []);
        setNextCursor(data.nextCursor ?? null);
        setTotalCount(data.totalCount ?? 0);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not load error logs.");
        setItems([]);
        setNextCursor(null);
      } finally {
        setLoading(false);
      }
    },
    [canView, pageSize, source, searchApplied, dateFromApplied, dateToApplied],
  );

  React.useEffect(() => {
    setCursorStack([null]);
    setPageIndex(0);
    void load(null);
  }, [load]);

  function refresh() {
    setCursorStack([null]);
    setPageIndex(0);
    void load(null);
  }

  function applyDateFilter() {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      toast.error("From date must be on or before To date.");
      return;
    }
    setDateFromApplied(dateFrom);
    setDateToApplied(dateTo);
  }

  function resetToLast7Days() {
    const range = last7DaysRange();
    setDateFrom(range.from);
    setDateTo(range.to);
    setDateFromApplied(range.from);
    setDateToApplied(range.to);
  }

  function goNext() {
    if (!nextCursor) return;
    const cursor = nextCursor;
    setCursorStack((prev) => [...prev, cursor]);
    setPageIndex((p) => p + 1);
    void load(cursor);
  }

  function goPrev() {
    if (pageIndex <= 0) return;
    const prevStack = cursorStack.slice(0, -1);
    const cursor = prevStack[prevStack.length - 1] ?? null;
    setCursorStack(prevStack.length ? prevStack : [null]);
    setPageIndex((p) => Math.max(0, p - 1));
    void load(cursor);
  }

  if (!canView) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader
          title="Error logs"
          description="Workspace owners and admins can review request and runtime failures."
        />
        <PageBody className="space-y-4">
          <LogsTabBar value="errors" />
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              You need owner or admin access on this workspace to view error logs.
            </CardContent>
          </Card>
        </PageBody>
      </div>
    );
  }

  const rangeStart = items.length === 0 ? 0 : pageIndex * pageSize + 1;
  const rangeEnd = items.length === 0 ? 0 : rangeStart + items.length - 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Error logs"
        description="Shows the last 7 days by default. Use From / To to look up older failures."
        actions={
          <Button variant="outline" size="sm" disabled={loading} onClick={refresh}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2">Refresh</span>
          </Button>
        }
      />
      <PageBody className="min-h-0 flex-1 space-y-4">
        <LogsTabBar value="errors" />

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label
              htmlFor="error-log-from"
              className="text-xs text-muted-foreground flex items-center gap-1"
            >
              <Calendar className="h-3 w-3" />
              From
            </Label>
            <Input
              id="error-log-from"
              type="date"
              className="h-9 w-[150px]"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="error-log-to" className="text-xs text-muted-foreground">
              To
            </Label>
            <Input
              id="error-log-to"
              type="date"
              className="h-9 w-[150px]"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <Button type="button" size="sm" className="h-9" onClick={applyDateFilter}>
            Apply dates
          </Button>
          {!isDefaultLast7 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9"
              onClick={resetToLast7Days}
            >
              Last 7 days
            </Button>
          ) : null}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Source</Label>
            <Select
              value={source}
              onValueChange={(v) => {
                if (v === "client" || v === "server" || v === "all") setSource(v);
              }}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="client">Client</SelectItem>
                <SelectItem value="server">Server</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="error-log-search" className="text-xs text-muted-foreground">
              Search
            </Label>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setSearchApplied(search);
              }}
            >
              <Input
                id="error-log-search"
                className="h-9 w-[220px]"
                placeholder="Message, file, function…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Button type="submit" size="sm" variant="secondary" className="h-9">
                <Search className="h-3.5 w-3.5" />
              </Button>
            </form>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Rows</Label>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                const n = Number(v);
                if (PAGE_SIZE_OPTIONS.includes(n as (typeof PAGE_SIZE_OPTIONS)[number])) {
                  setPageSize(n as (typeof PAGE_SIZE_OPTIONS)[number]);
                }
              }}
            >
              <SelectTrigger className="w-[90px]">
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
        </div>

        <p className="text-xs text-muted-foreground">
          {isDefaultLast7
            ? "Showing the last 7 days. Change From / To and click Apply dates to search older logs."
            : `Showing ${dateFromApplied} → ${dateToApplied}.`}
        </p>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Error message</TableHead>
                    <TableHead>Function name</TableHead>
                    <TableHead className="w-[90px]">Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      </TableCell>
                    </TableRow>
                  ) : items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                        <div className="flex flex-col items-center gap-2">
                          <AlertTriangle className="h-5 w-5 opacity-50" />
                          No error logs yet. Failures will appear here when they are reported.
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((row) => {
                      const open = expandedId === row.id;
                      const dateLabel = row.createdAt
                        ? fmtDate(row.createdAt, "MMM d, yyyy")
                        : "-";
                      const timeLabel = row.createdAt
                        ? fmtDate(row.createdAt, "h:mm:ss a")
                        : "-";
                      return (
                        <React.Fragment key={row.id}>
                          <TableRow
                            className="cursor-pointer"
                            onClick={() =>
                              setExpandedId((id) => (id === row.id ? null : row.id))
                            }
                          >
                            <TableCell className="px-2">
                              <ChevronDown
                                className={cn(
                                  "h-4 w-4 text-muted-foreground transition-transform",
                                  open && "rotate-180",
                                )}
                              />
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm">
                              {dateLabel}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm tabular-nums">
                              {timeLabel}
                            </TableCell>
                            <TableCell className="max-w-[220px]">
                              <code className="block truncate text-[11px]" title={row.location}>
                                {row.location}
                              </code>
                            </TableCell>
                            <TableCell className="max-w-[280px]">
                              <span className="line-clamp-2 text-sm" title={row.message}>
                                {row.message}
                              </span>
                            </TableCell>
                            <TableCell className="max-w-[160px]">
                              <code
                                className="block truncate text-[11px]"
                                title={row.functionName}
                              >
                                {row.functionName}
                              </code>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="capitalize">
                                {row.source}
                              </Badge>
                            </TableCell>
                          </TableRow>
                          {open ? (
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                              <TableCell colSpan={7} className="px-4 py-3">
                                <div className="space-y-2 text-xs">
                                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                                    {row.route ? (
                                      <span>
                                        Route: <code className="text-foreground">{row.route}</code>
                                      </span>
                                    ) : null}
                                    {row.url ? (
                                      <span className="max-w-full truncate">
                                        URL: <code className="text-foreground">{row.url}</code>
                                      </span>
                                    ) : null}
                                    {row.httpStatus != null ? (
                                      <span>HTTP: {row.httpStatus}</span>
                                    ) : null}
                                    {row.actorEmail || row.actorUid ? (
                                      <span>
                                        Actor:{" "}
                                        {row.actorEmail ?? row.actorUid ?? "—"}
                                      </span>
                                    ) : null}
                                  </div>
                                  {row.stack ? (
                                    <pre className="max-h-56 overflow-auto rounded-md border bg-background p-2 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap break-words">
                                      {row.stack}
                                    </pre>
                                  ) : (
                                    <p className="text-muted-foreground">No stack trace captured.</p>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </React.Fragment>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
              <span>
                {totalCount > 0
                  ? `Showing ${rangeStart}–${rangeEnd} of ${totalCount}`
                  : "No rows"}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading || pageIndex <= 0}
                  onClick={goPrev}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading || !nextCursor}
                  onClick={goNext}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </div>
  );
}
