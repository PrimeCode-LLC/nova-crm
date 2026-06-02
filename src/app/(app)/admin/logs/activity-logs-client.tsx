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
  labelForAuditEvent,
  categoryForAuditEvent,
  type AuditEventCategory,
} from "@/lib/firestore/audit-events";
import type { OrgMemberRole } from "@/lib/types";
import { roleAtLeast } from "@/lib/platform/org-role";

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
};

type MemberOption = { uid: string; label: string };

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

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

function metaSummary(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof meta.feature === "string") parts.push(meta.feature);
  else if (typeof meta.label === "string") parts.push(meta.label);
  if (typeof meta.path === "string" && !parts.includes(meta.path)) {
    parts.push(meta.path);
  }
  if (typeof meta.leadId === "string") parts.push(`Lead ${meta.leadId.slice(0, 8)}…`);
  if (typeof meta.email === "string") parts.push(meta.email);
  if (typeof meta.role === "string") parts.push(`role → ${meta.role}`);
  if (typeof meta.status === "string") parts.push(meta.status);
  if (typeof meta.campaignId === "string") {
    parts.push(`campaign ${meta.campaignId.slice(0, 8)}…`);
  }
  if (typeof meta.scanId === "string") {
    parts.push(`scan ${meta.scanId.slice(0, 8)}…`);
  }
  if (parts.length === 0 && Object.keys(meta).length > 0) {
    try {
      const raw = JSON.stringify(meta);
      return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
    } catch {
      return "";
    }
  }
  return parts.join(" · ");
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

  React.useEffect(() => {
    void load(page);
  }, [page, load]);

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
        description="Audit trail of team changes, integrations, AI usage, and feature visits across your workspace."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => {
              cursorsRef.current = [null];
              if (page === 1) void load(1);
              else setPage(1);
            }}
          >
            {loading ? (
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
              <Filter className="h-3 w-3" />
              Category
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
        </div>

        <Card className="overflow-visible">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="h-4 w-4" />
              Recent activity
            </CardTitle>
            <CardDescription>
              Newest events first. Page visits are recorded at most once per minute per screen.
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">When</TableHead>
                    <TableHead className="w-[160px]">Who</TableHead>
                    <TableHead className="w-[110px]">Type</TableHead>
                    <TableHead>Activity</TableHead>
                    <TableHead className="hidden lg:table-cell">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => {
                    const cat = categoryForAuditEvent(row.event);
                    const details = metaSummary(row.meta);
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="align-top text-sm">
                          <div className="font-medium tabular-nums">
                            {fmtRelative(row.createdAt ?? undefined)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {fmtDate(row.createdAt ?? undefined, "MMM d, h:mm a")}
                          </div>
                        </TableCell>
                        <TableCell className="align-top text-sm">
                          <div className="font-medium">{row.actorDisplayName}</div>
                          {row.actorEmail && (
                            <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {row.actorEmail}
                            </div>
                          )}
                          {row.actorOrgRole && (
                            <div className="text-xs text-muted-foreground capitalize">
                              {row.actorOrgRole}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge variant={CATEGORY_VARIANT[cat]} className="text-[10px]">
                            {CATEGORY_LABELS[cat]}
                          </Badge>
                        </TableCell>
                        <TableCell className="align-top text-sm">
                          {labelForAuditEvent(row.event)}
                        </TableCell>
                        <TableCell className="align-top text-sm text-muted-foreground hidden lg:table-cell max-w-md truncate">
                          {details || "—"}
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
