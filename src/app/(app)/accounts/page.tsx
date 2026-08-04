"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { WorkspacePageSkeleton } from "@/components/common/workspace-page-skeleton";
import { fmtCurrency, fmtNumber, fmtRelative } from "@/lib/format";
import { COMPANY_SIZES, REVENUE_RANGES } from "@/lib/constants";
import { UserChip } from "@/components/common/user-chip";
import { useOpenQuickAdd } from "@/components/layout/quick-add-launcher";
import { cn } from "@/lib/utils";
import type { Account, RevenueRange } from "@/lib/types";
import { ArrowDown, ArrowUp, Building2, Globe, Plus, Search, Upload } from "lucide-react";

const REVENUE_SORT_ORDER: RevenueRange[] = [
  "lt_1m",
  "1m_10m",
  "10m_50m",
  "50m_100m",
  "100m_500m",
  "500m_1b",
  "gt_1b",
  "unknown",
];

function revenueRank(r: RevenueRange | undefined): number {
  if (!r) return -1;
  const i = REVENUE_SORT_ORDER.indexOf(r);
  return i === -1 ? 999 : i;
}

function sizeRank(s: Account["size"]): number {
  if (!s) return -1;
  const i = COMPANY_SIZES.indexOf(s);
  return i === -1 ? 999 : i;
}

type SortKey =
  | "name"
  | "industry"
  | "size"
  | "revenue"
  | "location"
  | "contacts"
  | "leads"
  | "openDeals"
  | "owner"
  | "updated";

function compareAccountsAsc(
  a: Account,
  b: Account,
  key: SortKey,
  getUserById: (id: string) => { displayName: string } | undefined,
): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name);
    case "industry":
      return (a.industry ?? "").localeCompare(b.industry ?? "");
    case "size":
      return sizeRank(a.size) - sizeRank(b.size);
    case "revenue":
      return revenueRank(a.revenueRange) - revenueRank(b.revenueRange);
    case "location":
      return (a.location ?? "").localeCompare(b.location ?? "");
    case "contacts":
      return a.contactCount - b.contactCount;
    case "leads":
      return a.leadCount - b.leadCount;
    case "openDeals":
      return a.openDealValue - b.openDealValue;
    case "owner": {
      const na = getUserById(a.ownerId)?.displayName ?? "";
      const nb = getUserById(b.ownerId)?.displayName ?? "";
      return na.localeCompare(nb);
    }
    case "updated":
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    default:
      return 0;
  }
}

function SortableTableHead({
  label,
  columnKey,
  activeKey,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  columnKey: SortKey;
  activeKey: SortKey | null;
  dir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = activeKey === columnKey;
  return (
    <TableHead
      className={cn(
        "h-9 select-none whitespace-nowrap",
        align === "right" && "text-right",
      )}
    >
      <button
        type="button"
        className={cn(
          "inline-flex max-w-full items-center gap-0.5 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
          align === "right" && "flex w-full min-w-0 justify-end",
        )}
        onClick={() => onSort(columnKey)}
      >
        <span className="truncate">{label}</span>
        {active &&
          (dir === "asc" ? (
            <ArrowUp className="h-3 w-3 shrink-0 text-foreground" aria-hidden />
          ) : (
            <ArrowDown className="h-3 w-3 shrink-0 text-foreground" aria-hidden />
          ))}
      </button>
    </TableHead>
  );
}

export default function AccountsPage() {
  const router = useRouter();
  const { accounts, isDemo, workspaceLoading, getUserById } = useWorkspace();
  const { openQuickAdd } = useOpenQuickAdd();
  const [query, setQuery] = React.useState("");
  const [sortKey, setSortKey] = React.useState<SortKey | null>(null);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc");

  const handleSort = React.useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return key;
    });
  }, []);

  const filtered = accounts.filter(
    (a) =>
      !query ||
      a.name.toLowerCase().includes(query.toLowerCase()) ||
      a.domain?.toLowerCase().includes(query.toLowerCase()) ||
      a.industry?.toLowerCase().includes(query.toLowerCase()),
  );

  const sortedRows = React.useMemo(() => {
    if (!sortKey) return filtered;
    const next = [...filtered];
    next.sort((a, b) => {
      const cmp = compareAccountsAsc(a, b, sortKey, getUserById);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return next;
  }, [filtered, sortKey, sortDir, getUserById]);

  return (
    <>
      <PageHeader
        title="Companies"
        description="Companies we're selling into, deduped by domain."
        actions={
          <>
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
            <Button size="sm" onClick={() => openQuickAdd({ initialPill: "account" })}>
              <Plus className="h-3.5 w-3.5" /> New company
            </Button>
          </>
        }
      />
      <PageBody>
        {workspaceLoading ? (
          <WorkspacePageSkeleton />
        ) : !isDemo && accounts.length === 0 ? (
          <WorkspaceEmptyHint title="No companies in workspace" />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search companies…"
                  className="pl-8 h-8"
                />
              </div>
            </div>

            <div className="rounded-md border overflow-hidden">
              <div className="overflow-x-auto scrollbar-thin">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow className="hover:bg-transparent">
                      <SortableTableHead
                        label="Company"
                        columnKey="name"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={handleSort}
                      />
                      <SortableTableHead
                        label="Industry"
                        columnKey="industry"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={handleSort}
                      />
                      <SortableTableHead
                        label="Size"
                        columnKey="size"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={handleSort}
                      />
                      <SortableTableHead
                        label="Revenue"
                        columnKey="revenue"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={handleSort}
                      />
                      <SortableTableHead
                        label="Location"
                        columnKey="location"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={handleSort}
                      />
                      <SortableTableHead
                        label="Contacts"
                        columnKey="contacts"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={handleSort}
                        align="right"
                      />
                      <SortableTableHead
                        label="Leads"
                        columnKey="leads"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={handleSort}
                        align="right"
                      />
                      <SortableTableHead
                        label="Open deals"
                        columnKey="openDeals"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={handleSort}
                        align="right"
                      />
                      <SortableTableHead
                        label="Owner"
                        columnKey="owner"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={handleSort}
                      />
                      <SortableTableHead
                        label="Updated"
                        columnKey="updated"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={handleSort}
                      />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedRows.map((a) => (
                      <TableRow
                        key={a.id}
                        tabIndex={0}
                        className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        onClick={() => router.push(`/accounts/${a.id}`)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            router.push(`/accounts/${a.id}`);
                          }
                        }}
                      >
                        <TableCell className="py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
                              <Building2 className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{a.name}</div>
                              {a.domain && (
                                <div className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                                  <Globe className="h-2.5 w-2.5 shrink-0" />
                                  {a.domain}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-2">
                          <Badge variant="outline" className="text-[10px] font-normal">
                            {a.industry}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2 text-sm text-muted-foreground">{a.size}</TableCell>
                        <TableCell className="py-2 text-sm text-muted-foreground">
                          {a.revenueRange ? REVENUE_RANGES[a.revenueRange] : "-"}
                        </TableCell>
                        <TableCell className="py-2 text-sm text-muted-foreground">{a.location}</TableCell>
                        <TableCell className="py-2 text-right tabular-nums">{a.contactCount}</TableCell>
                        <TableCell className="py-2 text-right tabular-nums">{a.leadCount}</TableCell>
                        <TableCell className="py-2 text-right tabular-nums">
                          {a.openDealValue > 0 ? (
                            <span className="font-semibold text-success">{fmtCurrency(a.openDealValue)}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2">
                          <UserChip userId={a.ownerId} size="xs" />
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-2 text-xs text-muted-foreground">
                          {fmtRelative(a.updatedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              Showing <span className="tabular-nums font-medium text-foreground">{fmtNumber(sortedRows.length)}</span> of{" "}
              <span className="tabular-nums">{fmtNumber(accounts.length)}</span> companies
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
