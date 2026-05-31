"use client";

import * as React from "react";
import {
  Loader2,
  RefreshCw,
  ScrollText,
  Filter,
  User,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [category, setCategory] = React.useState<string>("all");
  const [actorUid, setActorUid] = React.useState<string>("all");

  const load = React.useCallback(
    async (opts?: { cursor?: string; append?: boolean }) => {
      if (!canView) return;
      const params = new URLSearchParams({ limit: "50" });
      if (opts?.cursor) params.set("cursor", opts.cursor);
      if (category !== "all") params.set("category", category);
      if (actorUid !== "all") params.set("actorUid", actorUid);

      if (opts?.append) setLoadingMore(true);
      else setLoading(true);

      try {
        const res = await fetch(`/api/org/audit-logs?${params}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Failed (${res.status})`);
        }
        const data = (await res.json()) as { items: AuditRow[]; nextCursor: string | null };
        setNextCursor(data.nextCursor);
        setItems((prev) => (opts?.append ? [...prev, ...data.items] : data.items));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not load activity logs");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [canView, category, actorUid],
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  if (!canView) {
    return (
      <>
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
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Activity logs"
        description="Audit trail of team changes, integrations, AI usage, and feature visits across your workspace."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void load()}
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
      <PageBody className="space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Filter className="h-3 w-3" />
              Category
            </span>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v ?? "all")}
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
              onValueChange={(v) => setActorUid(v ?? "all")}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Everyone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.uid} value={m.uid}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
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
                No activity recorded yet. Events appear as your team uses the CRM, AI tools, and
                admin settings.
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
            {nextCursor && (
              <div className="border-t p-4 flex justify-center">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={loadingMore}
                  onClick={() => void load({ cursor: nextCursor, append: true })}
                >
                  {loadingMore ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <ChevronDown className="h-4 w-4 mr-2" />
                  )}
                  Load more
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
